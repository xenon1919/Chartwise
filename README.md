# Chartwise: Chat With Your Data Copilot

Connect a CSV, spreadsheet or database and ask questions in plain English. For each question you get a **chart, the SQL that produced it, and a one-line summary of the result.**

---

## What it does

- **Plain English to SQL.** The question, the table schema, real column values and the earlier questions in the conversation go to the AI engine, which returns SQL and a chart plan.
- **Chooses the chart type.** Trends become lines, rankings become bars, shares become donuts and relationships become scatter plots. Single numbers are shown as a large number. Users can switch the chart type with one click.
- **Shows its SQL.** Every answer includes the SQL behind it. Users can copy it, or edit it and run it again in place.
- **Fixes its own failed queries.** If a query fails, the database error goes back to the model, which repairs the SQL (up to 3 attempts).
- **Read-only.** Only single `SELECT`/`WITH` statements run. Write keywords are blocked, connections are read-only and results are capped at 5,000 rows.
- **Understands follow-ups.** "Now split that by channel" or "only for 2025" builds on the previous query.
- **Accepts many data sources.** CSV, TSV, Excel (all sheets), JSON, SQLite, and live PostgreSQL or MySQL. Messy headers and values like `"$1,200"` are cleaned when the file is imported.
- **Adds a one-line summary.** Each answer states the leader, the gap, the growth or the correlation.
- **Exports.** Results download as CSV and charts as PNG.
- **Works offline.** With no API key, a built-in rule-based engine handles totals, averages, rates, trends, top-N, filters and comparisons, so the demo still works.

## How it's organised

| Folder    | What's inside |
|-----------|---------------|
| `client/` | The web app: landing page (`/`) and the copilot (`/app`) |
| `server/` | The gateway: validation, rate limits, uploads and question history (port 5050) |
| `engine/` | The analytics engine: schema profiling, query safety checks, execution and chart choice (port 8001), with 3 bundled sample datasets |

## Run it locally

Requirements: **Node 18+** and **Python 3.10+**.

```bash
npm run setup      # installs everything and creates the Python virtualenv + .env
npm run dev        # starts engine, gateway and client together
```

Open **http://localhost:5173**.

To turn on the AI engine, put your API key in `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Without a key the app uses the offline demo engine. The **Auto / AI / Demo** switch in the app's top bar picks the engine.

### Production

```bash
npm start          # builds the client; the gateway serves it at http://localhost:5050
```

## Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Turns on the AI engine |
| `CLAUDE_MODEL` | `claude-opus-5` | Model used to generate SQL |
| `CLAUDE_EFFORT` | `medium` | Reasoning effort (`low` … `max`). Lower is faster and cheaper; higher handles harder questions. |
| `PORT` | `5050` | Gateway port |
| `ENGINE_URL` | `http://127.0.0.1:8001` | Where the gateway finds the analytics engine |

## Troubleshooting

**"Can't reach the analytics service"**: an earlier copy of the app is probably still holding a port. Close every terminal running the app and run `npm run dev` again. The page reconnects by itself once the service is back.

## Personalising

Edit `client/src/config.js` to change the product name, author, contact and social links shown on the landing page.

## Security notes

- Connect databases with a **read-only user**. The app has its own guardrails too, but a read-only user protects the database even if one of them fails.
- Connection strings are stored locally in `engine/storage/registry.json` and are masked in every API response.
- Uploaded files are converted to SQLite under `engine/storage/`.
