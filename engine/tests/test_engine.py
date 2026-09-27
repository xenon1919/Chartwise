"""Smoke tests for the analytics engine: guardrails, the offline engine and the HTTP API."""
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.pop("ANTHROPIC_API_KEY", None)  # always exercise the offline engine in CI

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.safety import UnsafeQueryError, ensure_read_only  # noqa: E402

client = TestClient(app)


@pytest.mark.parametrize("sql", [
    "DELETE FROM t",
    "DROP TABLE t",
    "SELECT 1; DROP TABLE t",
    "UPDATE t SET a = 1",
    "SELECT * INTO copy FROM t",
    "PRAGMA table_info(t)",
])
def test_guardrails_block_writes(sql):
    with pytest.raises(UnsafeQueryError):
        ensure_read_only(sql)


@pytest.mark.parametrize("sql", [
    "SELECT * FROM t",
    "WITH x AS (SELECT 1) SELECT * FROM x",
    "SELECT 'drop table' AS label FROM t",
    "SELECT last_update, REPLACE(name, 'a', 'b') FROM t;",
])
def test_guardrails_allow_reads(sql):
    assert ensure_read_only(sql)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_sample_datasets_listed():
    ids = {d["id"] for d in client.get("/datasets").json()}
    assert {"ecommerce", "saas", "hr"} <= ids


@pytest.mark.parametrize("dataset,question,chart", [
    ("ecommerce", "What is the monthly revenue trend?", "line"),
    ("ecommerce", "Top 5 products by revenue", "bar"),
    ("ecommerce", "Revenue share by channel", "pie"),
    ("ecommerce", "How many orders in 2025?", "kpi"),
    ("saas", "Churn rate by plan", "bar"),
    ("saas", "Relationship between seats and mrr", "scatter"),
    ("hr", "Average salary by department", "bar"),
])
def test_ask_demo_engine(dataset, question, chart):
    r = client.post("/ask", json={"dataset_id": dataset, "question": question, "engine": "demo"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sql"].upper().startswith("SELECT")
    assert body["row_count"] > 0
    assert body["chart"]["type"] == chart
    assert body["insight"]


def test_follow_up_keeps_measure():
    first = client.post("/ask", json={"dataset_id": "saas", "question": "Churn rate by plan", "engine": "demo"}).json()
    r = client.post("/ask", json={
        "dataset_id": "saas", "question": "now by industry", "engine": "demo",
        "history": [{"question": "Churn rate by plan", "sql": first["sql"]}],
    }).json()
    assert "industry" in r["sql"] and "churned" in r["sql"]


def test_unrecognised_question_is_declined():
    r = client.post("/ask", json={"dataset_id": "ecommerce", "question": "asdf qwerty", "engine": "demo"}).json()
    assert r.get("unanswerable") is True


def test_run_rejects_writes():
    r = client.post("/run", json={"dataset_id": "ecommerce", "sql": "DELETE FROM ecommerce_orders"})
    assert r.status_code == 400


def test_upload_cleans_values_and_can_be_queried():
    csv = b'Deal ID,Close Date,Rep,Amount (USD)\n1,2025-01-14,Asha,"$12,500"\n2,2025-02-03,Ben,"$8,000"\n'
    r = client.post("/datasets/upload", files={"file": ("deals.csv", csv, "text/csv")})
    assert r.status_code == 200, r.text
    ds = r.json()
    try:
        cols = {c["name"]: c["kind"] for c in ds["tables"][0]["columns"]}
        assert cols["amount_usd"] == "numeric"
        assert cols["close_date"] == "date"
        run = client.post("/run", json={"dataset_id": ds["id"], "sql": "SELECT SUM(amount_usd) AS total FROM deals"}).json()
        assert run["rows"][0][0] == 20500
    finally:
        client.delete(f"/datasets/{ds['id']}")
