// Node.js API gateway: validation, rate limiting, uploads, query history and
// static hosting in front of the Python analytics engine.
import './env.js';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engine, EngineError } from './engine.js';
import { history } from './history.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5050);
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');
const UPLOAD_EXTENSIONS = ['.csv', '.tsv', '.txt', '.xlsx', '.xls', '.json', '.db', '.sqlite', '.sqlite3'];

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api')) console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`);
  });
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (UPLOAD_EXTENSIONS.includes(ext)) return cb(null, true);
    cb(new EngineError(400, `Unsupported file type "${ext || 'unknown'}". Use CSV, Excel, JSON or SQLite.`));
  },
});

const askLimiter = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.ASK_RATE_LIMIT || 40),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many questions in a minute — take a breath and try again shortly.' },
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/api/health', wrap(async (req, res) => {
  try {
    const status = await engine.get('/health');
    res.json({ gateway: 'ok', engine: 'ok', ...status });
  } catch {
    res.status(503).json({ gateway: 'ok', engine: 'down', llm: false });
  }
}));

app.get('/api/datasets', wrap(async (req, res) => res.json(await engine.get('/datasets'))));
app.get('/api/datasets/:id', wrap(async (req, res) => res.json(await engine.get(`/datasets/${encodeURIComponent(req.params.id)}`))));

app.get('/api/datasets/:id/preview', wrap(async (req, res) => {
  const params = new URLSearchParams({ table: String(req.query.table || ''), limit: String(req.query.limit || 50) });
  res.json(await engine.get(`/datasets/${encodeURIComponent(req.params.id)}/preview?${params}`));
}));

app.delete('/api/datasets/:id', wrap(async (req, res) => {
  await engine.del(`/datasets/${encodeURIComponent(req.params.id)}`);
  history.clear(req.params.id);
  res.json({ ok: true });
}));

app.post('/api/datasets/upload', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw new EngineError(400, 'Attach a file to upload.');
  const form = new FormData();
  form.append('file', new Blob([req.file.buffer]), req.file.originalname);
  if (req.body?.name) form.append('name', String(req.body.name).slice(0, 80));
  res.json(await engine.postForm('/datasets/upload', form));
}));

app.post('/api/datasets/connect', wrap(async (req, res) => {
  const { url, name } = req.body || {};
  if (!url || typeof url !== 'string' || !/^[a-z0-9+]+:\/\//i.test(url.trim())) {
    throw new EngineError(400, 'Enter a connection string like postgresql://user:pass@host:5432/db');
  }
  res.json(await engine.post('/datasets/connect', { url: url.trim(), name }));
}));

app.post('/api/ask', askLimiter, wrap(async (req, res) => {
  const { datasetId, question, history: turns = [], engine: mode = 'auto' } = req.body || {};
  const q = typeof question === 'string' ? question.trim() : '';
  if (!datasetId) throw new EngineError(400, 'Pick a dataset first.');
  if (!q) throw new EngineError(400, 'Ask a question about your data.');
  if (q.length > 1000) throw new EngineError(400, 'Questions are limited to 1,000 characters.');
  const safeTurns = (Array.isArray(turns) ? turns : [])
    .slice(-6)
    .map((t) => ({ question: String(t?.question || '').slice(0, 1000), sql: t?.sql ? String(t.sql).slice(0, 8000) : null }));

  const result = await engine.post('/ask', { dataset_id: datasetId, question: q, history: safeTurns, engine: mode });
  history.add(datasetId, { question: q, engine: result.engine, chart: result.chart?.type, rows: result.row_count });
  res.json(result);
}));

app.post('/api/run', askLimiter, wrap(async (req, res) => {
  const { datasetId, sql } = req.body || {};
  if (!datasetId || !sql) throw new EngineError(400, 'Provide a dataset and SQL to run.');
  res.json(await engine.post('/run', { dataset_id: datasetId, sql: String(sql) }));
}));

app.get('/api/history/:id', (req, res) => res.json(history.list(req.params.id)));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { maxAge: '1h', index: false }));
  app.get('*', (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Files up to 50 MB are supported.' : err.message;
    return res.status(400).json({ error: msg });
  }
  if (err instanceof EngineError) return res.status(err.status).json({ error: err.message, sql: err.sql });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const server = app.listen(PORT, () => {
  console.log(`Gateway listening on http://localhost:${PORT} → engine ${engine.baseUrl}`);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use — an earlier copy of the app is probably still running.`
      + '\nClose the other terminal (or end the leftover process) and start the app again.\n');
    process.exit(1);
  }
  throw err;
});
