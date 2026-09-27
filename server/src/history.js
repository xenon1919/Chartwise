// Recent questions per dataset, persisted to a small JSON file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/history.json');
const MAX_PER_DATASET = 30;

let store = {};
try {
  store = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch {
  store = {};
}

let pending;
function persist() {
  clearTimeout(pending);
  pending = setTimeout(() => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFile(FILE, JSON.stringify(store), () => {});
  }, 250);
}

export const history = {
  list: (datasetId) => store[datasetId] || [],
  add(datasetId, entry) {
    const items = (store[datasetId] || []).filter((e) => e.question.toLowerCase() !== entry.question.toLowerCase());
    store[datasetId] = [{ ...entry, at: new Date().toISOString() }, ...items].slice(0, MAX_PER_DATASET);
    persist();
  },
  clear(datasetId) {
    delete store[datasetId];
    persist();
  },
};
