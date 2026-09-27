"""Claude-powered engine: schema-grounded natural language → SQL + chart spec."""
from __future__ import annotations

import json
import os

import anthropic

from .datasets import Dataset

MODEL = os.getenv("CLAUDE_MODEL", "claude-opus-5")
EFFORT = os.getenv("CLAUDE_EFFORT", "medium")

DIALECT_NAMES = {"sqlite": "SQLite", "postgres": "PostgreSQL", "mysql": "MySQL", "mssql": "SQL Server"}

SYSTEM_PROMPT = """You are the SQL engine behind a "chat with your data" analytics copilot used by business people.
Translate each question into ONE read-only query for the database described below, and choose the chart that answers it best.

SQL rules
- Write a single SELECT (CTEs allowed). Never modify data. Use only tables and columns from the schema.
- Target the stated SQL dialect exactly (date functions differ: SQLite uses strftime, PostgreSQL uses date_trunc/to_char, MySQL uses DATE_FORMAT).
- Give every computed column a short snake_case alias (e.g. total_revenue, avg_salary, churn_rate_pct). Round money and averages to 2 decimals and percentages to 1.
- Time series: bucket dates to a sensible grain (month by default), alias the bucket as the grain name (month, week, quarter, year) as a sortable string like 2025-03, and order chronologically.
- Rankings: order by the measure and LIMIT to what was asked (top 10 if "top" has no number). Category breakdowns: cap at 50 rows.
- Rates on 0/1 flag columns: AVG(flag) * 100 AS <flag>_rate_pct.
- Filters on text values must use values that actually appear in the schema's sample values; match case exactly.
- Row listings: select the useful columns and LIMIT 100.
- If the question is a follow-up ("now by region", "only for 2025"), build on the previous query in the conversation.

Chart rules
- chart.type is one of: bar, line, area, pie, scatter, histogram, kpi, table.
  - kpi: a single headline number (one row). line/area: change over time. bar: comparing categories/rankings.
  - pie: share of a whole with at most 8 slices. scatter: relationship between two numeric columns. histogram: distribution of one numeric column (put it in x).
  - table: row listings or results that don't chart well.
- chart.x and every entry of chart.y must be exact column aliases from your SELECT. Use chart.color (a SELECT alias) to split a series by a second category, else "".
- Never put two measures with different units on one chart.
- chart.title: a short human title, e.g. "Monthly revenue, 2025".

Other fields
- explanation: one or two plain-English sentences describing what the query computes and any assumption you made. No SQL jargon.
- followups: exactly 3 short, natural next questions this data can answer.
- If the question cannot be answered from this schema, set sql to "" and use explanation to say what is missing and suggest what can be asked instead."""

OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "sql": {"type": "string"},
        "explanation": {"type": "string"},
        "chart": {
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": ["bar", "line", "area", "pie", "scatter", "histogram", "kpi", "table"]},
                "x": {"type": "string"},
                "y": {"type": "array", "items": {"type": "string"}},
                "color": {"type": "string"},
                "title": {"type": "string"},
            },
            "required": ["type", "x", "y", "color", "title"],
            "additionalProperties": False,
        },
        "followups": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["sql", "explanation", "chart", "followups"],
    "additionalProperties": False,
}


class LLMError(RuntimeError):
    pass


def schema_context(ds: Dataset) -> str:
    lines = [f"Database: {ds.name}", f"SQL dialect: {DIALECT_NAMES.get(ds.dialect, ds.dialect)}", ""]
    for t in ds.tables:
        lines.append(f"TABLE {t.name}  ({t.row_count:,} rows)")
        for c in t.columns:
            detail = ""
            if c.kind == "category" and c.values:
                vals = ", ".join(repr(v) for v in c.values[:25])
                more = f", … (+{len(c.values) - 25} more)" if len(c.values) > 25 else ""
                detail = f" values: {vals}{more}"
            elif c.kind in ("numeric", "date") and c.min is not None:
                detail = f" range: {c.min} → {c.max}"
            elif c.kind == "boolean":
                detail = " flag: 0/1"
            nulls = f" ({c.nulls} nulls in sample)" if c.nulls else ""
            lines.append(f"  - {c.name} [{c.type or c.kind}, {c.kind}]{detail}{nulls}")
        lines.append("")
    return "\n".join(lines)


def available() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))


class ClaudeEngine:
    name = "claude"

    def __init__(self) -> None:
        self.client = anthropic.Anthropic(max_retries=2, timeout=90.0)

    def generate(self, question: str, ds: Dataset, history: list[dict] | None = None,
                 failed_sql: str | None = None, error: str | None = None) -> dict:
        parts = []
        if history:
            convo = "\n\n".join(
                f"Q: {h.get('question', '')}\nSQL: {h.get('sql') or '(none)'}" for h in history[-4:]
            )
            parts.append(f"<conversation_so_far>\n{convo}\n</conversation_so_far>")
        parts.append(f"<question>{question}</question>")
        if failed_sql:
            parts.append(
                f"<previous_attempt>\nYour previous SQL failed when executed.\nSQL:\n{failed_sql}\nError: {error}\n"
                f"</previous_attempt>\nFix the query so it runs on this database."
            )

        request = dict(
            model=MODEL,
            max_tokens=16000,
            system=[
                {"type": "text", "text": SYSTEM_PROMPT},
                {"type": "text", "text": f"<schema>\n{schema_context(ds)}</schema>", "cache_control": {"type": "ephemeral"}},
            ],
            messages=[{"role": "user", "content": "\n\n".join(parts)}],
            thinking={"type": "adaptive"},
            output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
        )
        try:
            response = self.client.beta.messages.create(
                **request, betas=["server-side-fallback-2026-07-01"], fallbacks="default"
            )
        except anthropic.BadRequestError as exc:
            if "fallback" not in str(exc).lower():
                raise LLMError("The AI engine rejected the request.") from exc
            response = self.client.messages.create(**request)
        except anthropic.AuthenticationError as exc:
            raise LLMError("The AI engine's API key was rejected.") from exc
        except anthropic.RateLimitError as exc:
            raise LLMError("The AI engine is busy right now — try again in a few seconds.") from exc
        except anthropic.APIConnectionError as exc:
            raise LLMError("Couldn't reach the AI engine. Check your network connection.") from exc
        except anthropic.APIStatusError as exc:
            raise LLMError(f"The AI engine returned an error ({exc.status_code}).") from exc

        if response.stop_reason == "refusal":
            raise LLMError("The AI engine declined to answer this question.")
        if response.stop_reason == "max_tokens":
            raise LLMError("The response was cut off before it finished — try a narrower question.")
        text = next((b.text for b in response.content if b.type == "text"), "")
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise LLMError("The AI engine returned an unreadable response.") from exc
        data["model"] = response.model
        return data
