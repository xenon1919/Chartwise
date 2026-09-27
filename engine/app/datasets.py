"""Dataset registry: ingest files / connections, profile schemas, run read-only SQL."""
from __future__ import annotations

import json
import re
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine

from .safety import UnsafeQueryError, ensure_read_only

ROOT = Path(__file__).resolve().parent.parent
STORAGE = ROOT / "storage"
SAMPLES = ROOT / "samples"
REGISTRY_FILE = STORAGE / "registry.json"
MAX_RESULT_ROWS = 5000
PROFILE_SAMPLE_ROWS = 5000


@dataclass
class Column:
    name: str
    type: str
    kind: str  # numeric | date | category | text | boolean
    values: list = field(default_factory=list)  # distinct values for low-cardinality columns
    min: float | str | None = None
    max: float | str | None = None
    nulls: int = 0


@dataclass
class Table:
    name: str
    row_count: int
    columns: list[Column]


@dataclass
class Dataset:
    id: str
    name: str
    description: str
    source: str  # sample | upload | connection
    dialect: str
    url: str
    created_at: float
    tables: list[Table] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)
    icon: str = "database"

    def public(self, include_schema: bool = True) -> dict:
        data = asdict(self)
        data.pop("url")
        data["connection"] = mask_url(self.url) if self.source == "connection" else None
        data["row_count"] = sum(t.row_count for t in self.tables)
        if not include_schema:
            data["tables"] = [{"name": t.name, "row_count": t.row_count, "column_count": len(t.columns)} for t in self.tables]
        return data


SAMPLE_META = {
    "ecommerce": {
        "file": "ecommerce_orders.csv",
        "name": "E-commerce Orders",
        "icon": "shopping-bag",
        "description": "6,000 orders across 2024–2025 — revenue, products, regions, channels and returns.",
        "suggestions": [
            "What is the monthly revenue trend?",
            "Top 5 products by revenue",
            "Revenue share by channel",
            "Which region has the highest average order value?",
            "Return rate by category",
            "Compare revenue by category and region",
        ],
    },
    "saas": {
        "file": "saas_customers.csv",
        "name": "SaaS Customers",
        "icon": "rocket",
        "description": "1,800 B2B subscribers — plans, MRR, seats, NPS, acquisition channels and churn.",
        "suggestions": [
            "Total MRR by plan",
            "Churn rate by plan",
            "How many signups per month?",
            "Average NPS by industry",
            "Which acquisition channel brings the most MRR?",
            "Relationship between seats and mrr",
        ],
    },
    "hr": {
        "file": "hr_employees.csv",
        "name": "People Analytics",
        "icon": "users",
        "description": "1,200 employees — departments, salaries, locations, performance and attrition.",
        "suggestions": [
            "Average salary by department",
            "Headcount by location",
            "Attrition rate by department",
            "Gender distribution",
            "How many hires per year?",
            "Average engagement score by performance score",
        ],
    },
}


def _is_texty(s: pd.Series) -> bool:
    return pd.api.types.is_object_dtype(s) or pd.api.types.is_string_dtype(s)


def mask_url(url: str) -> str:
    return re.sub(r"(://[^:/@]+):[^@]+@", r"\1:••••@", url)


def slug(value: str) -> str:
    value = re.sub(r"[^0-9a-zA-Z]+", "_", str(value).strip()).strip("_").lower()
    if not value:
        value = "col"
    if value[0].isdigit():
        value = f"c_{value}"
    return value


def _sqlite_url(path: Path, read_only: bool) -> str:
    posix = path.resolve().as_posix()
    return f"sqlite:///file:{posix}?mode=ro&uri=true" if read_only else f"sqlite:///{posix}"


class Registry:
    def __init__(self) -> None:
        STORAGE.mkdir(exist_ok=True)
        self._lock = threading.Lock()
        self._engines: dict[str, Engine] = {}
        self.datasets: dict[str, Dataset] = {}
        self._load()
        self._ensure_samples()

    # ---------- persistence ----------
    def _load(self) -> None:
        if not REGISTRY_FILE.exists():
            return
        try:
            raw = json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return
        for item in raw:
            tables = [Table(t["name"], t["row_count"], [Column(**c) for c in t["columns"]]) for t in item.pop("tables", [])]
            self.datasets[item["id"]] = Dataset(**item, tables=tables)

    def _save(self) -> None:
        payload = [asdict(d) for d in self.datasets.values()]
        REGISTRY_FILE.write_text(json.dumps(payload, indent=1, default=str), encoding="utf-8")

    def _ensure_samples(self) -> None:
        from samples.generate import ensure_samples  # local import keeps startup light

        ensure_samples()
        changed = False
        for ds_id, meta in SAMPLE_META.items():
            db_path = STORAGE / f"{ds_id}.sqlite"
            if ds_id in self.datasets and db_path.exists():
                continue
            df = pd.read_csv(SAMPLES / meta["file"])
            table = Path(meta["file"]).stem
            self._write_sqlite(db_path, {table: df})
            ds = Dataset(
                id=ds_id, name=meta["name"], description=meta["description"], source="sample",
                dialect="sqlite", url=_sqlite_url(db_path, read_only=True), created_at=time.time(),
                suggestions=meta["suggestions"], icon=meta["icon"],
            )
            ds.tables = self._profile(ds)
            self.datasets[ds_id] = ds
            changed = True
        if changed:
            self._save()

    # ---------- ingest ----------
    @staticmethod
    def _write_sqlite(path: Path, frames: dict[str, pd.DataFrame]) -> None:
        if path.exists():
            path.unlink()
        engine = create_engine(_sqlite_url(path, read_only=False))
        with engine.begin() as conn:
            for name, df in frames.items():
                df.to_sql(name, conn, index=False, if_exists="replace", chunksize=2000)
        engine.dispose()

    @staticmethod
    def _clean_frame(df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        seen: dict[str, int] = {}
        cols = []
        for c in df.columns:
            s = slug(c)
            if s in seen:
                seen[s] += 1
                s = f"{s}_{seen[s]}"
            else:
                seen[s] = 0
            cols.append(s)
        df.columns = cols
        df = df.dropna(how="all")
        for c in df.columns:
            if pd.api.types.is_datetime64_any_dtype(df[c]):
                df[c] = df[c].dt.strftime("%Y-%m-%d")
            elif _is_texty(df[c]):
                sample = df[c].dropna().astype(str).head(200)
                if len(sample) == 0:
                    continue
                # Numbers stored as text with currency/thousand separators, e.g. "$1,200.50"
                stripped = sample.str.replace(r"[,$€£₹%\s]", "", regex=True)
                if pd.to_numeric(stripped, errors="coerce").notna().mean() > 0.95:
                    df[c] = pd.to_numeric(df[c].astype(str).str.replace(r"[,$€£₹%\s]", "", regex=True), errors="coerce")
                    continue
                if sample.str.contains(r"\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}").mean() > 0.9:
                    parsed = pd.to_datetime(df[c], errors="coerce", format="mixed")
                    if parsed.notna().mean() > 0.9:
                        has_time = (parsed.dt.hour.fillna(0) + parsed.dt.minute.fillna(0)).abs().sum() > 0
                        df[c] = parsed.dt.strftime("%Y-%m-%d %H:%M:%S" if has_time else "%Y-%m-%d")
        return df

    def ingest_file(self, filename: str, content: bytes, name: str | None = None) -> Dataset:
        ext = Path(filename).suffix.lower()
        ds_id = uuid.uuid4().hex[:10]
        db_path = STORAGE / f"{ds_id}.sqlite"
        base = slug(Path(filename).stem) or "data"
        tmp = STORAGE / f"_upload_{ds_id}{ext}"
        tmp.write_bytes(content)
        try:
            if ext in (".csv", ".tsv", ".txt"):
                sep = "\t" if ext == ".tsv" else None
                df = pd.read_csv(tmp, sep=sep, engine="python", encoding_errors="replace")
                frames = {base: self._clean_frame(df)}
            elif ext in (".xlsx", ".xls"):
                sheets = pd.read_excel(tmp, sheet_name=None)
                frames = {slug(s) if len(sheets) > 1 else base: self._clean_frame(df) for s, df in sheets.items() if not df.empty}
            elif ext == ".json":
                frames = {base: self._clean_frame(pd.read_json(tmp))}
            elif ext in (".db", ".sqlite", ".sqlite3"):
                tmp.replace(db_path)
                frames = None
            else:
                raise ValueError(f"Unsupported file type '{ext}'. Use CSV, TSV, Excel, JSON or SQLite.")
            if frames is not None:
                if not frames or all(df.empty for df in frames.values()):
                    raise ValueError("The file has no rows to analyse.")
                self._write_sqlite(db_path, frames)
        finally:
            tmp.unlink(missing_ok=True)

        ds = Dataset(
            id=ds_id, name=name or Path(filename).stem.replace("_", " ").title(),
            description=f"Uploaded from {filename}", source="upload", dialect="sqlite",
            url=_sqlite_url(db_path, read_only=True), created_at=time.time(), icon="file",
        )
        try:
            ds.tables = self._profile(ds)
        except Exception:
            db_path.unlink(missing_ok=True)
            raise
        if not ds.tables:
            db_path.unlink(missing_ok=True)
            raise ValueError("No tables found in the uploaded file.")
        ds.suggestions = suggest_questions(ds)
        with self._lock:
            self.datasets[ds_id] = ds
            self._save()
        return ds

    def connect(self, url: str, name: str | None = None) -> Dataset:
        url = url.strip()
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        if url.startswith("mysql://"):
            url = "mysql+pymysql://" + url[len("mysql://"):]
        ds_id = uuid.uuid4().hex[:10]
        dialect = url.split(":", 1)[0].split("+", 1)[0]
        if dialect == "postgresql":
            dialect = "postgres"
        ds = Dataset(
            id=ds_id, name=name or f"{dialect.title()} database", description=f"Live connection · {mask_url(url)}",
            source="connection", dialect=dialect, url=url, created_at=time.time(), icon="server",
        )
        ds.tables = self._profile(ds)
        if not ds.tables:
            raise ValueError("Connected, but no tables were visible to this user.")
        ds.suggestions = suggest_questions(ds)
        with self._lock:
            self.datasets[ds_id] = ds
            self._save()
        return ds

    def delete(self, ds_id: str) -> None:
        ds = self.get(ds_id)
        if ds.source == "sample":
            raise ValueError("Sample datasets can't be removed.")
        with self._lock:
            engine = self._engines.pop(ds_id, None)
            if engine:
                engine.dispose()
            self.datasets.pop(ds_id, None)
            (STORAGE / f"{ds_id}.sqlite").unlink(missing_ok=True)
            self._save()

    # ---------- access ----------
    def get(self, ds_id: str) -> Dataset:
        if ds_id not in self.datasets:
            raise KeyError(ds_id)
        return self.datasets[ds_id]

    def engine(self, ds: Dataset) -> Engine:
        if ds.id not in self._engines:
            kwargs = {"pool_pre_ping": True}
            if ds.dialect != "sqlite":
                kwargs["connect_args"] = {"connect_timeout": 8}
            self._engines[ds.id] = create_engine(ds.url, **kwargs)
        return self._engines[ds.id]

    def _profile(self, ds: Dataset) -> list[Table]:
        engine = self.engine(ds) if ds.id in self.datasets else create_engine(ds.url)
        insp = inspect(engine)
        tables: list[Table] = []
        names = insp.get_table_names()[:40]
        with engine.connect() as conn:
            for tname in names:
                q = _quote(tname, ds.dialect)
                row_count = conn.execute(text(f"SELECT COUNT(*) FROM {q}")).scalar() or 0
                df = pd.read_sql(text(f"SELECT * FROM {q} LIMIT {PROFILE_SAMPLE_ROWS}"), conn)
                sql_types = {c["name"]: str(c["type"]) for c in insp.get_columns(tname)}
                cols = [_profile_column(name, df[name], sql_types.get(name, "")) for name in df.columns]
                tables.append(Table(tname, int(row_count), cols))
        if ds.id not in self.datasets:
            self._engines[ds.id] = engine
        return tables

    def preview(self, ds: Dataset, table: str, limit: int = 50) -> dict:
        if table not in {t.name for t in ds.tables}:
            raise KeyError(table)
        return self.run(ds, f"SELECT * FROM {_quote(table, ds.dialect)} LIMIT {int(limit)}")

    def run(self, ds: Dataset, sql: str) -> dict:
        sql = ensure_read_only(sql)
        started = time.perf_counter()
        engine = self.engine(ds)
        with engine.connect() as conn:
            if ds.dialect == "postgres":
                conn.execute(text("SET TRANSACTION READ ONLY"))
                conn.execute(text("SET LOCAL statement_timeout = 15000"))
            result = conn.execute(text(sql))
            columns = list(result.keys())
            raw = result.fetchmany(MAX_RESULT_ROWS + 1)
            conn.rollback()
        truncated = len(raw) > MAX_RESULT_ROWS
        df = pd.DataFrame([tuple(r) for r in raw[:MAX_RESULT_ROWS]], columns=columns)
        return {
            "sql": sql,
            "columns": columns,
            "rows": _json_rows(df),
            "row_count": len(df),
            "truncated": truncated,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
            "frame": df,
        }


def _quote(name: str, dialect: str) -> str:
    return f"`{name}`" if dialect == "mysql" else f'"{name}"'


def _json_rows(df: pd.DataFrame) -> list[list]:
    out = df.astype(object).where(pd.notna(df), None)
    rows = []
    for row in out.itertuples(index=False, name=None):
        clean = []
        for v in row:
            if hasattr(v, "isoformat"):
                v = v.isoformat()
            elif hasattr(v, "item"):
                v = v.item()
            elif isinstance(v, (bytes, bytearray)):
                v = v.hex()
            elif v is not None and not isinstance(v, (int, float, str, bool)):
                v = str(v)
            clean.append(v)
        rows.append(clean)
    return rows


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def _profile_column(name: str, s: pd.Series, sql_type: str) -> Column:
    non_null = s.dropna()
    nulls = int(s.isna().sum())
    t = sql_type.upper()
    if len(non_null) and (pd.api.types.is_datetime64_any_dtype(s) or "DATE" in t or "TIME" in t or
                          (_is_texty(s) and non_null.astype(str).str.match(DATE_RE).mean() > 0.95)):
        vals = non_null.astype(str)
        return Column(name, sql_type or "DATE", "date", min=vals.min(), max=vals.max(), nulls=nulls)
    if pd.api.types.is_bool_dtype(s) or (pd.api.types.is_numeric_dtype(s) and len(non_null) and set(non_null.unique()) <= {0, 1}
                                          and re.search(r"(^is_|^has_|churn|returned|remote|left|active|flag|converted)", name)):
        return Column(name, sql_type or "BOOLEAN", "boolean", values=[0, 1], nulls=nulls)
    if pd.api.types.is_numeric_dtype(s):
        uniq = non_null.nunique()
        is_id = bool(re.search(r"(^id$|_id$|^id_)", name)) and uniq > 0.9 * max(len(non_null), 1)
        if is_id:
            return Column(name, sql_type or "INTEGER", "text", nulls=nulls)
        return Column(name, sql_type or "NUMERIC", "numeric",
                      min=float(non_null.min()) if len(non_null) else None,
                      max=float(non_null.max()) if len(non_null) else None, nulls=nulls)
    vals = non_null.astype(str)
    uniq = vals.nunique()
    if uniq and (uniq <= 30 or uniq <= 0.05 * len(vals)) and uniq <= 60:
        top = vals.value_counts().index.tolist()[:60]
        return Column(name, sql_type or "TEXT", "category", values=top, nulls=nulls)
    return Column(name, sql_type or "TEXT", "text", nulls=nulls)


def suggest_questions(ds: Dataset) -> list[str]:
    if not ds.tables:
        return []
    t = max(ds.tables, key=lambda x: x.row_count)
    nums = [c.name for c in t.columns if c.kind == "numeric"]
    cats = [c.name for c in t.columns if c.kind == "category"]
    dates = [c.name for c in t.columns if c.kind == "date"]
    bools = [c.name for c in t.columns if c.kind == "boolean"]
    h = lambda s: s.replace("_", " ")
    out: list[str] = []
    if nums and cats:
        out.append(f"Total {h(nums[0])} by {h(cats[0])}")
    if dates:
        out.append(f"Monthly trend of {h(nums[0])}" if nums else f"How many rows per month?")
    if nums and cats:
        noun = h(cats[-1])
        noun = noun[:-1] + "ies" if noun.endswith("y") and not noun.endswith(("ay", "ey", "oy")) else noun if noun.endswith("s") else noun + "s"
        out.append(f"Top 5 {noun} by {h(nums[-1])}")
    if len(cats) > 1:
        out.append(f"Share of records by {h(cats[1])}")
    if bools and cats:
        out.append(f"{h(bools[0]).title()} rate by {h(cats[0])}")
    if len(nums) > 1:
        out.append(f"Average {h(nums[1])} by {h(cats[0])}" if cats else f"Relationship between {h(nums[0])} and {h(nums[1])}")
    if not out:
        out.append(f"How many rows are in {h(t.name)}?")
    return out[:6]


registry: Registry | None = None


def get_registry() -> Registry:
    global registry
    if registry is None:
        registry = Registry()
    return registry


__all__ = ["get_registry", "Dataset", "UnsafeQueryError"]
