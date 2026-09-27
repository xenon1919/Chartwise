"""Guardrails: only a single read-only SELECT/WITH statement may reach a database."""
from __future__ import annotations

import re


class UnsafeQueryError(ValueError):
    pass


FORBIDDEN = re.compile(
    r"\b(insert|update|delete|merge|upsert|drop|alter|create|truncate|grant|revoke|attach|detach|"
    r"pragma|vacuum|reindex|load_extension|into|pg_sleep|pg_read_file|pg_read_binary_file|lo_import|dblink)\b",
    re.IGNORECASE,
)


def _strip_comments_and_strings(sql: str) -> str:
    sql = re.sub(r"--[^\n]*", " ", sql)
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    # Blank out string literals and quoted identifiers so their contents can't trip the keyword check
    return re.sub(r"'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\"|`[^`]*`", "''", sql)


def ensure_read_only(sql: str) -> str:
    if not sql or not sql.strip():
        raise UnsafeQueryError("The query is empty.")
    cleaned = sql.strip().rstrip(";").strip()
    code = _strip_comments_and_strings(cleaned)
    if ";" in code:
        raise UnsafeQueryError("Only a single statement is allowed.")
    if not re.match(r"^\s*(select|with)\b", code, re.IGNORECASE):
        raise UnsafeQueryError("Only SELECT queries are allowed — this copilot is read-only.")
    bad = FORBIDDEN.search(code)
    if bad:
        raise UnsafeQueryError(f"Blocked keyword '{bad.group(0).upper()}' — this copilot is read-only.")
    return cleaned
