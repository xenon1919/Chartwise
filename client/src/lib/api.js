async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.sql = body.sql;
    err.status = res.status;
    throw err;
  }
  return body;
}

const json = (method, body) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  health: () => request('/health'),
  datasets: () => request('/datasets'),
  dataset: (id) => request(`/datasets/${id}`),
  preview: (id, table) => request(`/datasets/${id}/preview?table=${encodeURIComponent(table)}&limit=100`),
  remove: (id) => request(`/datasets/${id}`, { method: 'DELETE' }),
  upload: (file, name) => {
    const form = new FormData();
    form.append('file', file);
    if (name) form.append('name', name);
    return request('/datasets/upload', { method: 'POST', body: form });
  },
  connect: (url, name) => request('/datasets/connect', json('POST', { url, name })),
  ask: (payload) => request('/ask', json('POST', payload)),
  run: (datasetId, sql) => request('/run', json('POST', { datasetId, sql })),
  history: (id) => request(`/history/${id}`),
};
