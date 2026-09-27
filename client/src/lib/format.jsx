export function humanize(name = '') {
  const s = String(name).replace(/_/g, ' ').replace(/\bpct\b/g, '%').replace(/\bavg\b/g, 'average').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const MONEY = /(revenue|sales|amount|price|mrr|arr|salary|cost|value|spend|income|gmv)/i;
const PCT = /(pct|percent|rate)/i;

export function formatValue(v, col = '') {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v !== 'number') return String(v);
  if (PCT.test(col)) return `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  const money = MONEY.test(col);
  const abs = Math.abs(v);
  let s;
  if (abs >= 1e9) s = `${(v / 1e9).toFixed(2)}B`;
  else if (abs >= 1e6) s = `${(v / 1e6).toFixed(2)}M`;
  else if (abs >= 1e4) s = `${(v / 1e3).toFixed(1)}K`;
  else s = v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return money ? `$${s}` : s;
}

export function formatCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return String(v);
}

export function isMoney(col) {
  return MONEY.test(col) && !PCT.test(col);
}

export function isPct(col) {
  return PCT.test(col);
}

export function toCsv(columns, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}

export function download(filename, content, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugify(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'result';
}

// Render **bold** from engine insights without dangerouslySetInnerHTML
export function richText(text = '') {
  return String(text).split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}
