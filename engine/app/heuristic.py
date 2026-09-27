"""Offline "demo engine": a rule-based natural-language → SQL translator.

It lets the copilot work end-to-end with no API key (handy for client demos on
flaky Wi-Fi). It understands aggregates, group-bys, time buckets, filters on
category values and years, top-N, rates on boolean columns, distributions and
scatter plots. Anything more nuanced is what the Claude engine is for.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .charts import humanize
from .datasets import Column, Dataset, Table

RESERVED = {"order", "group", "date", "year", "month", "user", "select", "table", "from", "where", "value",
            "rank", "count", "key", "level", "position", "range", "row", "rows", "time", "timestamp", "week", "day"}
GENERIC_TOKENS = {"date", "id", "name", "score", "count", "type", "value", "total", "number", "years", "year",
                  "company", "per", "rate", "time"}

MEASURE_SYNONYMS = {
    r"\b(sales|value|amount|income|money|earnings|gmv|turnover)\b": r"(revenue|sales|amount|total|gmv|mrr|price)",
    r"\b(pay|paid|compensation|wage|wages|comp)\b": r"(salary|pay|wage|compensation)",
    r"\b(satisfaction)\b": r"(nps|rating|satisfaction|score)",
}
BOOL_SYNONYMS = {
    r"\b(attrition|turnover|leavers|quit)\b": r"(left|attrition|terminated|quit|churn)",
    r"\bchurn\w*\b": r"(churn)",
    r"\breturn\w*\b": r"(return)",
}
SEP = ",\n  "
COUNT_NOUNS = r"\b(headcount|employees|people|customers|orders|signups|sign ups|users|records|rows|transactions|deals|accounts|subscribers|hires|entries)\b"

TIME_PATTERNS = [
    ("quarter", r"\b(quarterly|per quarter|by quarter|each quarter|qoq)\b"),
    ("week", r"\b(weekly|per week|by week|each week|wow)\b"),
    ("day", r"\b(daily|per day|by day|each day)\b"),
    ("year", r"\b(yearly|per year|by year|each year|annual|annually|yoy|year over year)\b"),
    ("month", r"\b(monthly|per month|by month|each month|mom|month over month)\b"),
    ("auto", r"\b(over time|trend|trends|timeline|evolution|growth over|history of|trajectory)\b"),
]


@dataclass
class Match:
    column: Column
    pos: int


def stem(word: str) -> str:
    w = word.lower()
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 5 and w.endswith("ed"):
        return w[:-2]
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def plural(word: str) -> str:
    if word.endswith("y") and not word.endswith(("ay", "ey", "oy")):
        return word[:-1] + "ies"
    return word if word.endswith("s") else word + "s"


def norm_text(text: str) -> str:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return " " + " ".join(stem(w) for w in words) + " "


def qi(name: str, dialect: str) -> str:
    if re.fullmatch(r"[a-z_][a-z0-9_]*", name) and name not in RESERVED:
        return name
    return f"`{name}`" if dialect == "mysql" else f'"{name}"'


def lit(value) -> str:
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def time_bucket(col: str, grain: str, dialect: str) -> str:
    if dialect == "postgres":
        fmt = {"year": "YYYY", "month": "YYYY-MM", "quarter": 'YYYY-"Q"Q', "week": 'IYYY-"W"IW', "day": "YYYY-MM-DD"}[grain]
        return f"to_char(CAST({col} AS date), '{fmt}')"
    if dialect == "mysql":
        if grain == "quarter":
            return f"CONCAT(YEAR({col}), '-Q', QUARTER({col}))"
        fmt = {"year": "%Y", "month": "%Y-%m", "week": "%x-W%v", "day": "%Y-%m-%d"}[grain]
        return f"DATE_FORMAT({col}, '{fmt}')"
    if grain == "quarter":
        return f"strftime('%Y', {col}) || '-Q' || ((CAST(strftime('%m', {col}) AS INTEGER) + 2) / 3)"
    fmt = {"year": "%Y", "month": "%Y-%m", "week": "%Y-W%W", "day": "%Y-%m-%d"}[grain]
    return f"strftime('{fmt}', {col})"


def year_expr(col: str, dialect: str) -> str:
    if dialect == "postgres":
        return f"to_char(CAST({col} AS date), 'YYYY')"
    if dialect == "mysql":
        return f"CAST(YEAR({col}) AS CHAR)"
    return f"strftime('%Y', {col})"


class DemoEngine:
    name = "demo"

    def generate(self, question: str, ds: Dataset, history: list[dict] | None = None) -> dict:
        q = question.strip()
        q = self._merge_followup(q, ds, history or [])
        table = self._pick_table(q, ds)
        plan = self._plan(q, table, ds.dialect)
        plan["followups"] = self._followups(plan, table)
        return plan

    # ---------- understanding ----------
    def _aliases(self, table: Table) -> dict[str, list[str]]:
        token_owner: dict[str, list[str]] = {}
        for c in table.columns:
            for tok in c.name.split("_"):
                token_owner.setdefault(stem(tok), []).append(c.name)
        aliases = {}
        for c in table.columns:
            forms = {" ".join(stem(t) for t in c.name.split("_"))}
            for tok in c.name.split("_"):
                s = stem(tok)
                if len(s) >= 3 and s not in GENERIC_TOKENS and len(token_owner[s]) == 1:
                    forms.add(s)
            aliases[c.name] = sorted(forms, key=len, reverse=True)
        return aliases

    def _find_columns(self, q: str, table: Table) -> list[Match]:
        nq = norm_text(q)
        found: list[Match] = []
        # Longest alias wins, and each stretch of the question is claimed by one column only
        # ("unit price" → unit_price, not units)
        candidates = sorted(((form, c) for c in table.columns for form in self._aliases(table)[c.name]),
                            key=lambda fc: -len(fc[0]))
        claimed = [False] * len(nq)
        taken: set[str] = set()
        for form, c in candidates:
            if c.name in taken:
                continue
            start = 0
            while (i := nq.find(f" {form} ", start)) >= 0:
                span = range(i + 1, i + 1 + len(form))
                if not any(claimed[k] for k in span):
                    for k in span:
                        claimed[k] = True
                    found.append(Match(c, i))
                    taken.add(c.name)
                    break
                start = i + 1
        lower = q.lower()
        for pat, target in {**MEASURE_SYNONYMS, **BOOL_SYNONYMS}.items():
            m = re.search(pat, lower)
            if not m or any(re.search(target, f.column.name) for f in found):
                continue
            for c in table.columns:
                if re.search(target, c.name) and c.kind in ("numeric", "boolean"):
                    found.append(Match(c, len(norm_text(lower[:m.start()]))))
                    break
        return sorted(found, key=lambda m: m.pos)

    def _pick_table(self, q: str, ds: Dataset) -> Table:
        nq = norm_text(q)
        best, best_score = None, -1.0
        for t in ds.tables:
            score = len(self._find_columns(q, t)) + (2 if f" {' '.join(stem(p) for p in t.name.split('_'))} " in nq else 0)
            score += t.row_count / 1e9  # tie-break on size
            if score > best_score:
                best, best_score = t, score
        return best

    def _merge_followup(self, q: str, ds: Dataset, history: list[dict]) -> str:
        if not history:
            return q
        lower = q.lower()
        starts = re.match(r"^(and|what about|how about|now|same|then|also|only|just|break (it|that|this) down|split)\b", lower) or \
            (len(lower.split()) <= 5 and re.match(r"^(by|per|for|in)\b", lower))
        if not starts:
            return q
        prev = history[-1].get("question", "")
        # Keep the previous question's "what" (aggregate words + measures), take the new slicing
        table = self._pick_table(prev, ds)
        agg_words = re.findall(r"\b(average|avg|mean|median|total|sum|max|min|how many|number of|count|headcount|rate|"
                               r"top \d+|bottom \d+|top|bottom|share|trend|monthly|yearly|over time)\b", prev.lower())
        measures = [m.column.name.replace("_", " ") for m in self._find_columns(prev, table)
                    if m.column.kind in ("numeric", "boolean")]
        base = " ".join(agg_words + measures)
        rest = re.sub(r"^(and|what about|how about|now|same|then|also|only|just)\s+", "", q, flags=re.I)
        rest = re.sub(r"^(break (it|that|this) down|split( it)?)\s*", "", rest, flags=re.I)
        return f"{base.strip()} {rest.strip()}"

    def _plan(self, q: str, t: Table, dialect: str) -> dict:
        lower = q.lower()
        nq = norm_text(q)
        matches = self._find_columns(q, t)
        cols = {c.name: c for c in t.columns}
        T = qi(t.name, dialect)

        # --- filters from category values and years ---
        filters: list[tuple[str, str]] = []  # (sql, human)
        filter_cols: set[str] = set()
        for c in t.columns:
            if c.kind != "category":
                continue
            for v in sorted(c.values, key=lambda x: -len(str(x))):
                sv = str(v)
                if len(sv) < 3 or not re.search(r"[a-zA-Z]", sv):
                    continue
                if f" {norm_text(sv).strip()} " in nq:
                    # "by region" + "Europe" → Europe is a filter; ignore values equal to column names
                    if norm_text(sv).strip() in (" ".join(stem(p) for p in c.name.split("_")),):
                        continue
                    filters.append((f"{qi(c.name, dialect)} = {lit(sv)}", f"{humanize(c.name).lower()} is {sv}"))
                    filter_cols.add(c.name)
                    break
        dates = [c for c in t.columns if c.kind == "date"]
        date_match = next((m.column for m in matches if m.column.kind == "date"), None)
        date_col = date_match or (dates[0] if dates else None)
        years = re.findall(r"\b(?:in|for|during|of|from)\s+((?:19|20)\d{2})\b", lower)
        if years and date_col:
            ye = year_expr(qi(date_col.name, dialect), dialect)
            filters.append((f"{ye} = '{years[0]}'", f"year is {years[0]}"))

        # --- time grain ---
        grain = None
        for g, pat in TIME_PATTERNS:
            if re.search(pat, lower):
                grain = g
                break
        if not grain and re.search(r"\bhow many\b.*\b(per|each|by)\s+(month|year|quarter|week|day)\b", lower):
            grain = re.search(r"\b(per|each|by)\s+(month|year|quarter|week|day)\b", lower).group(2)
        if grain == "auto":
            grain = "month"
            if date_col and date_col.min and date_col.max and int(str(date_col.max)[:4]) - int(str(date_col.min)[:4]) >= 5:
                grain = "year"
        if grain and not date_col:
            grain = None

        # --- dimensions: columns right after by/per/across, else any mentioned category ---
        by_positions = [len(norm_text(lower[:m.start()])) - 1 for m in re.finditer(r"\b(by|per|across|for each|each|vs|versus|and|between|of)\b", lower)]
        dims: list[Column] = []
        for m in matches:
            c = m.column
            if c.name in filter_cols or c.kind == "date":
                continue
            after_by = any(0 <= m.pos - p <= 12 for p in by_positions)
            # "avg engagement by performance score" groups by a number, but "top products by revenue" ranks by it
            earlier_measure = any(o.column.kind in ("numeric", "boolean") and o.pos < m.pos for o in matches)
            numeric_dim = c.kind == "numeric" and earlier_measure and \
                re.search(r"\b(by|per)\s+" + re.escape(c.name.replace("_", " ")), lower)
            if c.kind in ("category", "text") or (c.kind == "boolean" and after_by and not re.search(r"\brate\b", lower)) \
                    or numeric_dim:
                if c.kind == "text" and not after_by:
                    continue
                dims.append(c)

        measures = [m.column for m in matches if m.column.kind == "numeric" and m.column not in dims]
        bools = [m.column for m in matches if m.column.kind == "boolean" and m.column not in dims]

        # --- aggregation ---
        if re.search(r"\b(average|avg|mean|typical)\b", lower):
            agg = "AVG"
        elif re.search(r"\b(median)\b", lower):
            agg = "AVG"  # portable fallback; noted in explanation
        elif re.search(r"\b(max|maximum|largest single|biggest single)\b", lower):
            agg = "MAX"
        elif re.search(r"\b(min|minimum|smallest single)\b", lower):
            agg = "MIN"
        elif re.search(r"\b(how many|number of|count|headcount|volume)\b", lower) or (re.search(COUNT_NOUNS, lower) and not measures):
            agg = "COUNT"
        else:
            agg = "SUM"
        is_rate = bool(bools) and re.search(r"\b(rate|ratio|percent|percentage|share|%|likely|proportion)\b", lower)

        understood = matches or filters or grain or re.search(
            r"\b(how many|count|number of|total|rows|records|average|sum|list|show)\b|" + COUNT_NOUNS[3:-3], lower)
        if not understood:
            return {"sql": "", "chart": {"type": "table", "x": "", "y": [], "color": "", "title": ""},
                    "explanation": f"The offline demo engine couldn't match that question to any columns in "
                                   f"{humanize(t.name).lower()}. Try naming a column from the schema panel, or use "
                                   f"the AI engine for free-form questions."}

        # --- special shapes ---
        wants_scatter = re.search(r"\b(vs|versus|against|relationship|correlat\w*|scatter)\b", lower)
        num_matches = [m.column for m in matches if m.column.kind == "numeric"]
        if wants_scatter and len(num_matches) >= 2 and not grain:
            a, b = num_matches[0], num_matches[1]
            color = dims[0] if dims and dims[0].kind == "category" and len(dims[0].values) <= 3 else None
            sel = [qi(a.name, dialect), qi(b.name, dialect)] + ([qi(color.name, dialect)] if color else [])
            where = self._where(filters, extra=[f"{qi(a.name, dialect)} IS NOT NULL", f"{qi(b.name, dialect)} IS NOT NULL"])
            sql = f"SELECT\n  {SEP.join(sel)}\nFROM {T}{where}\nLIMIT 2000"
            return self._result(sql, {"type": "scatter", "x": a.name, "y": [b.name], "color": color.name if color else "",
                                      "title": f"{humanize(b.name)} vs {humanize(a.name)}"},
                                f"Plotted each row's {humanize(a.name).lower()} against {humanize(b.name).lower()} to show how they move together"
                                + self._filter_text(filters) + ".")

        if re.search(r"\b(distribution|histogram|spread)\b", lower) and measures and not dims and not grain:
            m = measures[0]
            where = self._where(filters, extra=[f"{qi(m.name, dialect)} IS NOT NULL"])
            sql = f"SELECT\n  {qi(m.name, dialect)}\nFROM {T}{where}\nLIMIT 5000"
            return self._result(sql, {"type": "histogram", "x": m.name, "y": [], "color": "", "title": f"Distribution of {humanize(m.name).lower()}"},
                                f"Pulled the raw {humanize(m.name).lower()} values so the histogram shows how they are spread" + self._filter_text(filters) + ".")

        is_listing = re.match(r"^\s*(list|show|display|give me|find|which|what are)\b", lower) and not measures and not bools \
            and agg in ("SUM", "COUNT") and not grain \
            and not re.search(r"\b(top|most|highest|best|largest|share|breakdown|how many|number of|count|headcount|total)\b", lower)
        if is_listing and (filters or not dims):
            where = self._where(filters)
            sql = f"SELECT *\nFROM {T}{where}\nLIMIT 100"
            return self._result(sql, {"type": "table", "x": "", "y": [], "color": "", "title": humanize(t.name)},
                                f"Listed matching rows from {humanize(t.name).lower()}" + self._filter_text(filters) + ".")

        # --- value expression ---
        if is_rate:
            b = bools[0]
            value_sql = f"ROUND(AVG(CAST({qi(b.name, dialect)} AS FLOAT)) * 100, 1)"
            alias = f"{b.name}_rate_pct"
            what = f"the share of rows where {humanize(b.name).lower()} is true"
        elif agg == "COUNT" or not measures:
            value_sql, alias, what = "COUNT(*)", "count", "the number of rows"
            if agg not in ("COUNT", "SUM") and measures:
                pass
        else:
            m = measures[0]
            col = qi(m.name, dialect)
            if agg == "AVG":
                value_sql, alias, what = f"ROUND(AVG({col}), 2)", f"avg_{m.name}", f"the average {humanize(m.name).lower()}"
            elif agg in ("MAX", "MIN"):
                value_sql, alias, what = f"{agg}({col})", f"{agg.lower()}_{m.name}", f"the {agg.lower()}imum {humanize(m.name).lower()}"
            else:
                value_sql, alias, what = f"ROUND(SUM({col}), 2)", f"total_{m.name}", f"total {humanize(m.name).lower()}"
        if not measures and not is_rate and bools and agg != "COUNT":
            b = bools[0]
            value_sql = f"ROUND(AVG(CAST({qi(b.name, dialect)} AS FLOAT)) * 100, 1)"
            alias, what = f"{b.name}_rate_pct", f"the share of rows where {humanize(b.name).lower()} is true"

        # --- ordering / limits ---
        top = re.search(r"\b(top|bottom|best|worst|highest|lowest)\s+(\d+)\b", lower)
        limit = int(top.group(2)) if top else (10 if re.search(r"\btop\b", lower) else None)
        ascending = bool(re.search(r"\b(bottom|lowest|least|worst|fewest|smallest|minimum)\b", lower))

        select, group, order = [], [], ""
        chart = {"type": "kpi", "x": "", "y": [alias], "color": "", "title": ""}
        dim = dims[0] if dims else None
        dim2 = dims[1] if len(dims) > 1 else None

        if grain:
            bucket = time_bucket(qi(date_col.name, dialect), grain, dialect)
            select.append(f"{bucket} AS {grain}")
            group.append(grain)
            order = f"ORDER BY {grain}"
            chart = {"type": "line", "x": grain, "y": [alias], "color": "", "title": ""}
            if dim:
                select.append(qi(dim.name, dialect))
                group.append(qi(dim.name, dialect))
                order += f", {qi(dim.name, dialect)}"
                chart["color"] = dim.name
            filters.append((f"{qi(date_col.name, dialect)} IS NOT NULL", ""))
        elif dim:
            select.append(qi(dim.name, dialect))
            group.append(qi(dim.name, dialect))
            chart = {"type": "bar", "x": dim.name, "y": [alias], "color": "", "title": ""}
            if dim2:
                select.append(qi(dim2.name, dialect))
                group.append(qi(dim2.name, dialect))
                chart["color"] = dim2.name
            if dim.kind == "numeric":
                order = f"ORDER BY {qi(dim.name, dialect)}"
            else:
                order = f"ORDER BY {alias} {'ASC' if ascending else 'DESC'}"
            share = re.search(r"\b(share|breakdown|split|distribution|proportion|mix|composition|percentage of)\b", lower)
            if share and not dim2 and dim.kind in ("category", "boolean") and 0 < len(dim.values) <= 8 and not is_rate \
                    and "AVG" not in value_sql:
                chart["type"] = "pie"
            if limit is None and not dim2:
                limit = 50
        select.append(f"{value_sql} AS {alias}")

        where = self._where(filters)
        sql = f"SELECT\n  {SEP.join(select)}\nFROM {T}{where}"
        if group:
            sql += f"\nGROUP BY {', '.join(group)}"
        if order:
            sql += f"\n{order}"
        if limit and (dim or grain):
            sql += f"\nLIMIT {limit}"

        by_text = ""
        if grain:
            by_text = f" per {grain} using {humanize(date_col.name).lower()}"
            if dim:
                by_text += f", split by {humanize(dim.name).lower()}"
        elif dim:
            by_text = f" for each {humanize(dim.name).lower()}" + (f" and {humanize(dim2.name).lower()}" if dim2 else "")
        rank_text = ""
        if limit and dim and top:
            rank_text = f", keeping the {'bottom' if ascending else 'top'} {limit}"
        elif dim and dim.kind != "numeric" and not grain:
            rank_text = f", sorted {'lowest' if ascending else 'highest'} first"
        explanation = f"Calculated {what}{by_text}{rank_text}{self._filter_text(filters)}."
        if re.search(r"\bmedian\b", lower):
            explanation += " (Median isn't portable across SQL dialects, so the demo engine uses the average.)"
        title = humanize(alias) + (f" by {humanize(dim.name).lower()}" if dim and not grain else "") + \
            (f" per {grain}" if grain else "")
        chart["title"] = title
        return self._result(sql, chart, explanation)

    @staticmethod
    def _where(filters: list[tuple[str, str]], extra: list[str] | None = None) -> str:
        parts = [f for f, _ in filters] + (extra or [])
        return ("\nWHERE " + "\n  AND ".join(parts)) if parts else ""

    @staticmethod
    def _filter_text(filters: list[tuple[str, str]]) -> str:
        human = [h for _, h in filters if h]
        return (" where " + " and ".join(human)) if human else ""

    @staticmethod
    def _result(sql: str, chart: dict, explanation: str) -> dict:
        return {"sql": sql, "chart": chart, "explanation": explanation}

    def _followups(self, plan: dict, t: Table) -> list[str]:
        cats = [c for c in t.columns if c.kind == "category"]
        nums = [c for c in t.columns if c.kind == "numeric"]
        dates = [c for c in t.columns if c.kind == "date"]
        chart = plan["chart"]
        used = {chart.get("x"), chart.get("color"), *chart.get("y", [])}
        measure = next((n for n in nums if any(n.name in (y or "") for y in chart.get("y", []))), nums[0] if nums else None)
        other_cats = [c for c in cats if c.name not in used]
        out = []
        if measure and dates and chart["type"] not in ("line", "area"):
            out.append(f"Monthly trend of {humanize(measure.name).lower()}")
        if measure and other_cats:
            out.append(f"Top 5 {plural(humanize(other_cats[0].name).lower())} by {humanize(measure.name).lower()}")
        if measure and chart["type"] in ("bar", "pie") and chart.get("x") and dates:
            out.append(f"{humanize(measure.name)} by {humanize(chart['x']).lower()} per year")
        if measure and len(other_cats) > 1:
            out.append(f"Average {humanize(measure.name).lower()} by {humanize(other_cats[1].name).lower()}")
        if len(nums) >= 2 and chart["type"] != "scatter":
            out.append(f"Relationship between {humanize(nums[0].name).lower()} and {humanize(nums[-1].name).lower()}")
        return out[:3]
