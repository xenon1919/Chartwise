"""Python analytics engine (FastAPI). The Node gateway is its only client."""
from __future__ import annotations

import time
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
load_dotenv(ROOT.parent / ".env")

from fastapi import FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402
from sqlalchemy.exc import SQLAlchemyError  # noqa: E402

from . import llm  # noqa: E402
from .charts import insight, validate_chart  # noqa: E402
from .datasets import get_registry  # noqa: E402
from .heuristic import DemoEngine  # noqa: E402
from .safety import UnsafeQueryError  # noqa: E402

@asynccontextmanager
async def lifespan(_: FastAPI):
    get_registry()  # load samples and profiles before the first request
    yield


app = FastAPI(title="Chartwise engine", version="1.0.0", lifespan=lifespan)
demo_engine = DemoEngine()
_claude: llm.ClaudeEngine | None = None
MAX_UPLOAD_BYTES = 50 * 1024 * 1024


def claude() -> llm.ClaudeEngine:
    global _claude
    if _claude is None:
        _claude = llm.ClaudeEngine()
    return _claude


def dataset_or_404(ds_id: str):
    try:
        return get_registry().get(ds_id)
    except KeyError:
        raise HTTPException(404, "Dataset not found.")


class Turn(BaseModel):
    question: str
    sql: str | None = None


class AskBody(BaseModel):
    dataset_id: str
    question: str = Field(min_length=1, max_length=1000)
    history: list[Turn] = []
    engine: str = "auto"  # auto | claude | demo


class RunBody(BaseModel):
    dataset_id: str
    sql: str = Field(min_length=1, max_length=20000)


class ConnectBody(BaseModel):
    url: str
    name: str | None = None




@app.get("/health")
def health():
    return {
        "ok": True,
        "llm": llm.available(),
        "model": llm.MODEL if llm.available() else None,
        "datasets": len(get_registry().datasets),
    }


@app.get("/datasets")
def list_datasets():
    items = sorted(get_registry().datasets.values(), key=lambda d: (d.source != "sample", -d.created_at if d.source != "sample" else 0))
    return [d.public(include_schema=False) for d in items]


@app.get("/datasets/{ds_id}")
def get_dataset(ds_id: str):
    return dataset_or_404(ds_id).public()


@app.delete("/datasets/{ds_id}")
def delete_dataset(ds_id: str):
    dataset_or_404(ds_id)
    try:
        get_registry().delete(ds_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"ok": True}


@app.get("/datasets/{ds_id}/preview")
def preview(ds_id: str, table: str, limit: int = 50):
    ds = dataset_or_404(ds_id)
    try:
        res = get_registry().preview(ds, table, min(max(limit, 1), 200))
    except KeyError:
        raise HTTPException(404, "Table not found.")
    res.pop("frame")
    return res


@app.post("/datasets/upload")
async def upload(file: UploadFile = File(...), name: str | None = Form(None)):
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Files up to 50 MB are supported.")
    try:
        ds = get_registry().ingest_file(file.filename or "upload.csv", content, name)
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:  # pandas raises many parser-specific errors
        raise HTTPException(400, f"Couldn't read that file: {exc}")
    return ds.public()


@app.post("/datasets/connect")
def connect(body: ConnectBody):
    try:
        ds = get_registry().connect(body.url, body.name)
    except ModuleNotFoundError as exc:
        raise HTTPException(400, f"Missing database driver: {exc.name}. Install it in the engine's virtualenv.")
    except (ValueError, SQLAlchemyError) as exc:
        msg = str(getattr(exc, "orig", None) or exc).splitlines()[0]
        raise HTTPException(400, f"Couldn't connect: {msg}")
    return ds.public()


def _execute(ds, sql: str) -> dict:
    return get_registry().run(ds, sql)


def _error_text(exc: Exception) -> str:
    return str(getattr(exc, "orig", None) or exc).splitlines()[0][:400]


def _package(res: dict, plan: dict, engine: str, started: float, attempts: int = 1, notice: str | None = None) -> dict:
    df = res.pop("frame")
    chart = validate_chart(plan.get("chart"), df, (plan.get("chart") or {}).get("title", ""))
    return {
        **res,
        "chart": chart,
        "explanation": plan.get("explanation", ""),
        "insight": insight(df, chart),
        "followups": plan.get("followups", [])[:3],
        "engine": engine,
        "model": plan.get("model"),
        "attempts": attempts,
        "notice": notice,
        "total_ms": round((time.perf_counter() - started) * 1000),
    }


def _unanswerable(plan: dict, engine: str, started: float) -> dict:
    return {
        "sql": "", "columns": [], "rows": [], "row_count": 0, "truncated": False,
        "chart": {"type": "table", "x": "", "y": [], "color": "", "title": ""},
        "explanation": plan.get("explanation", ""), "insight": "", "followups": plan.get("followups", [])[:3],
        "engine": engine, "model": plan.get("model"), "attempts": 1, "unanswerable": True, "notice": None,
        "total_ms": round((time.perf_counter() - started) * 1000),
    }


@app.post("/ask")
def ask(body: AskBody):
    ds = dataset_or_404(body.dataset_id)
    started = time.perf_counter()
    history = [t.model_dump() for t in body.history]
    use_claude = body.engine == "claude" or (body.engine == "auto" and llm.available())
    if body.engine == "claude" and not llm.available():
        raise HTTPException(400, "The AI engine isn't configured — switch to the demo engine.")

    notice = None
    if use_claude:
        try:
            plan = claude().generate(body.question, ds, history)
            if not plan.get("sql"):
                return _unanswerable(plan, "claude", started)
            attempts = 1
            while True:
                try:
                    res = _execute(ds, plan["sql"])
                    return _package(res, plan, "claude", started, attempts)
                except (SQLAlchemyError, UnsafeQueryError) as exc:
                    if attempts >= 3:
                        raise HTTPException(422, {"message": f"The generated SQL failed: {_error_text(exc)}", "sql": plan["sql"]})
                    attempts += 1
                    plan = claude().generate(body.question, ds, history, failed_sql=plan["sql"], error=_error_text(exc))
        except llm.LLMError as exc:
            if body.engine == "claude":
                raise HTTPException(502, str(exc))
            notice = f"{exc} Answered with the offline demo engine instead."

    plan = demo_engine.generate(body.question, ds, history)
    if not plan.get("sql"):
        return {**_unanswerable(plan, "demo", started), "notice": notice}
    try:
        res = _execute(ds, plan["sql"])
    except (SQLAlchemyError, UnsafeQueryError) as exc:
        raise HTTPException(422, {"message": f"The demo engine couldn't answer that: {_error_text(exc)}. "
                                             "Try rephrasing, or switch on the AI engine for free-form questions.", "sql": plan["sql"]})
    return _package(res, plan, "demo", started, notice=notice)


@app.post("/run")
def run(body: RunBody):
    ds = dataset_or_404(body.dataset_id)
    started = time.perf_counter()
    try:
        res = _execute(ds, body.sql)
    except UnsafeQueryError as exc:
        raise HTTPException(400, {"message": str(exc), "sql": body.sql})
    except SQLAlchemyError as exc:
        raise HTTPException(422, {"message": _error_text(exc), "sql": body.sql})
    plan = {"chart": None, "explanation": "Ran your edited SQL.", "followups": []}
    return _package(res, plan, "manual", started)
