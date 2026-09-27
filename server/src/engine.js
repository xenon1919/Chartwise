// Thin client for the Python engine that normalises its errors into { status, message, sql }.
const baseUrl = (process.env.ENGINE_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
const TIMEOUT_MS = Number(process.env.ENGINE_TIMEOUT_MS || 180_000);

export class EngineError extends Error {
  constructor(status, message, sql) {
    super(message);
    this.status = status;
    this.sql = sql;
  }
}

async function call(path, init = {}) {
  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new EngineError(504, 'The analytics engine took too long to respond.');
    throw new EngineError(503, 'The analytics service is offline. Please try again in a moment.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body?.detail;
    if (typeof detail === 'string') throw new EngineError(res.status, detail);
    if (detail && typeof detail === 'object' && detail.message) throw new EngineError(res.status, detail.message, detail.sql);
    if (Array.isArray(detail)) throw new EngineError(400, detail.map((d) => d.msg).join('; '));
    throw new EngineError(res.status, 'The analytics engine returned an error.');
  }
  return body;
}

export const engine = {
  baseUrl,
  get: (path) => call(path),
  del: (path) => call(path, { method: 'DELETE' }),
  post: (path, json) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) }),
  postForm: (path, form) => call(path, { method: 'POST', body: form }),
};
