"""Chart-spec validation/inference and plain-English insights computed from query results."""
from __future__ import annotations

import re

import pandas as pd

CHART_TYPES = {"bar", "line", "area", "pie", "scatter", "histogram", "kpi", "table"}
TIME_LIKE = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?( \d{2}:\d{2}(:\d{2})?)?$|^\d{4}-(Q[1-4]|W\d{1,2})$")


def _is_texty(s: pd.Series) -> bool:
    return pd.api.types.is_object_dtype(s) or pd.api.types.is_string_dtype(s)


def humanize(name: str) -> str:
    words = str(name).replace("_", " ").strip()
    words = re.sub(r"\bpct\b", "%", words)
    words = re.sub(r"\bavg\b", "average", words)
    return words[:1].upper() + words[1:]


def numeric_columns(df: pd.DataFrame) -> list[str]:
    out = []
    for c in df.columns:
        s = df[c]
        if pd.api.types.is_bool_dtype(s):
            continue
        if pd.api.types.is_numeric_dtype(s):
            out.append(c)
        elif _is_texty(s) and len(s.dropna()) and pd.to_numeric(s.dropna(), errors="coerce").notna().all() \
                and not s.dropna().astype(str).str.match(TIME_LIKE).all():
            out.append(c)
    return out


def is_time_column(s: pd.Series, name: str = "") -> bool:
    vals = s.dropna().astype(str)
    if not len(vals):
        return False
    if re.search(r"(date|month|year|week|day|quarter|period|time)", name.lower()) and vals.str.match(TIME_LIKE).mean() > 0.9:
        return True
    return vals.str.match(TIME_LIKE).mean() > 0.95 and vals.str.len().max() > 4


def infer_chart(df: pd.DataFrame, title: str = "") -> dict:
    spec = {"type": "table", "x": "", "y": [], "color": "", "title": title}
    if df.empty:
        return spec
    nums = numeric_columns(df)
    others = [c for c in df.columns if c not in nums]
    # ids masquerading as numbers shouldn't be plotted as measures
    nums = [c for c in nums if not re.search(r"(^id$|_id$)", str(c))] or nums

    if len(df) == 1 and nums and len(df.columns) <= 3:
        return {**spec, "type": "kpi", "y": nums[:1]}
    if others:
        x = others[0]
        color = others[1] if len(others) > 1 and df[others[1]].nunique() <= 12 else ""
        if not nums:
            return spec
        if is_time_column(df[x], str(x)):
            return {**spec, "type": "line", "x": x, "y": nums[:3] if not color else nums[:1], "color": color}
        if df[x].nunique() > 60:
            return spec
        return {**spec, "type": "bar", "x": x, "y": nums[:3] if not color else nums[:1], "color": color}
    if len(nums) >= 2 and len(df) > 1:
        # a numeric group key followed by an aggregate reads better as bars
        if df[nums[0]].is_unique and len(df) <= 40:
            return {**spec, "type": "bar", "x": nums[0], "y": nums[1:2]}
        return {**spec, "type": "scatter", "x": nums[0], "y": nums[1:2]}
    if len(nums) == 1 and len(df) > 1:
        return {**spec, "type": "histogram", "x": nums[0], "y": []}
    return spec


def validate_chart(spec: dict | None, df: pd.DataFrame, title: str = "") -> dict:
    """Keep a model-proposed chart only if it references real result columns; otherwise infer one."""
    if not spec or spec.get("type") not in CHART_TYPES:
        return infer_chart(df, title)
    cols = set(map(str, df.columns))
    t = spec["type"]
    x = spec.get("x") or ""
    y = [c for c in (spec.get("y") or []) if c in cols]
    color = spec.get("color") or ""
    if color and color not in cols:
        color = ""
    spec = {"type": t, "x": x, "y": y, "color": color, "title": spec.get("title") or title}
    if t == "table":
        return spec
    if t == "kpi":
        if not y:
            nums = numeric_columns(df)
            if not nums:
                return infer_chart(df, title)
            spec["y"] = nums[:1]
        return spec
    if t == "histogram":
        target = x if x in cols else (y[0] if y else "")
        if not target:
            return infer_chart(df, title)
        return {**spec, "x": target, "y": []}
    if x not in cols or not y:
        return infer_chart(df, title)
    return spec


def _fmt(v: float, col: str = "") -> str:
    if v is None or pd.isna(v):
        return "—"
    money = bool(re.search(r"(revenue|sales|amount|price|mrr|arr|salary|cost|value|spend|income|gmv)", col.lower()))
    pct = bool(re.search(r"(pct|percent|rate)", col.lower()))
    a = abs(v)
    if pct:
        return f"{v:.1f}%"
    if a >= 1e9:
        s = f"{v / 1e9:.2f}B"
    elif a >= 1e6:
        s = f"{v / 1e6:.2f}M"
    elif a >= 1e4:
        s = f"{v / 1e3:.1f}K"
    elif float(v).is_integer():
        s = f"{int(v):,}"
    else:
        s = f"{v:,.2f}"
    return f"${s}" if money else s


def insight(df: pd.DataFrame, spec: dict) -> str:
    """One or two sentences a stakeholder would say out loud about this result."""
    try:
        if df.empty:
            return "The query ran successfully but returned no rows — try loosening a filter."
        t = spec.get("type")
        y = (spec.get("y") or [None])[0]
        x = spec.get("x")
        if t == "kpi" and y:
            return f"{humanize(y)} is **{_fmt(pd.to_numeric(df[y]).iloc[0], y)}**."
        if t in ("bar", "pie") and x and y and not spec.get("color"):
            vals = pd.to_numeric(df[y], errors="coerce")
            top_i, low_i = vals.idxmax(), vals.idxmin()
            total = vals.sum()
            msg = f"Highest is **{df.loc[top_i, x]}** at {_fmt(vals[top_i], y)}"
            if total and vals.min() >= 0 and len(df) > 1 and not re.search(r"(avg|average|mean|rate|pct)", y.lower()):
                msg += f" ({vals[top_i] / total * 100:.0f}% of the {len(df)} shown)"
            if len(df) > 1:
                msg += f"; lowest is **{df.loc[low_i, x]}** at {_fmt(vals[low_i], y)}"
                if vals[low_i] > 0 and vals[top_i] / vals[low_i] >= 1.5:
                    msg += f", a {vals[top_i] / vals[low_i]:.1f}× gap"
            return msg + "."
        if t in ("line", "area") and x and y and not spec.get("color"):
            vals = pd.to_numeric(df[y], errors="coerce").reset_index(drop=True)
            xs = df[x].astype(str).reset_index(drop=True)
            if len(vals) < 2:
                return f"{humanize(y)} was {_fmt(vals.iloc[0], y)} in {xs.iloc[0]}."
            first, last = vals.iloc[0], vals.iloc[-1]
            peak_i = int(vals.idxmax())
            change = (last - first) / abs(first) * 100 if first else None
            msg = f"{humanize(y)} went from {_fmt(first, y)} ({xs.iloc[0]}) to {_fmt(last, y)} ({xs.iloc[-1]})"
            if change is not None:
                msg += f", a **{change:+.0f}%** change"
            return msg + f". Peak: **{xs.iloc[peak_i]}** at {_fmt(vals.iloc[peak_i], y)}."
        if t == "scatter" and x and y:
            a, b = pd.to_numeric(df[x], errors="coerce"), pd.to_numeric(df[y], errors="coerce")
            r = a.corr(b)
            if pd.notna(r):
                strength = "strong" if abs(r) > 0.6 else "moderate" if abs(r) > 0.3 else "weak"
                direction = "positive" if r > 0 else "negative"
                return f"{humanize(x)} and {humanize(y)} show a **{strength} {direction}** correlation (r = {r:.2f}) across {len(df):,} points."
        if t == "histogram" and x:
            s = pd.to_numeric(df[x], errors="coerce").dropna()
            return (f"{humanize(x)} ranges from {_fmt(s.min(), x)} to {_fmt(s.max(), x)}, "
                    f"with a median of **{_fmt(s.median(), x)}** across {len(s):,} rows.")
        if spec.get("color") and x and y:
            vals = pd.to_numeric(df[y], errors="coerce")
            i = vals.idxmax()
            return (f"Highest combination: **{df.loc[i, x]} · {df.loc[i, spec['color']]}** "
                    f"at {_fmt(vals[i], y)}.")
        return f"Returned {len(df):,} row{'s' if len(df) != 1 else ''}."
    except Exception:  # insights are a nicety; never fail a query because of them
        return f"Returned {len(df):,} rows."
