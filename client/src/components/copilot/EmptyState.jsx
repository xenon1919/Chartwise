import { ArrowUpRight, Sparkles, WifiOff, Upload, ShoppingBag, Rocket, Users, FileSpreadsheet, Server, Database } from 'lucide-react';

const DS_ICONS = { 'shopping-bag': ShoppingBag, rocket: Rocket, users: Users, file: FileSpreadsheet, server: Server };

export default function EmptyState({ dataset, llm, onAsk, onAdd }) {
  if (!dataset) {
    return (
      <div className="empty">
        <div className="empty-hero skeleton-hero" />
      </div>
    );
  }
  const Icon = DS_ICONS[dataset.icon] || Database;
  const cols = dataset.tables.reduce((n, t) => n + t.columns.length, 0);
  return (
    <div className="empty">
      <div className="empty-hero">
        <span className="empty-icon"><Icon size={26} /></span>
        <h1>What do you want to know about <span className="grad-text">{dataset.name}</span>?</h1>
        <p>{dataset.description}</p>
        <div className="empty-meta">
          <span className="chip">{dataset.row_count.toLocaleString()} rows</span>
          <span className="chip">{dataset.tables.length} table{dataset.tables.length === 1 ? '' : 's'}</span>
          <span className="chip">{cols} columns</span>
          <span className="chip">{dataset.source === 'connection' ? 'Live database' : dataset.source === 'upload' ? 'Uploaded file' : 'Sample data'}</span>
          {llm
            ? <span className="chip chip-accent"><Sparkles size={12} /> AI engine connected</span>
            : <span className="chip"><WifiOff size={12} /> Offline demo engine</span>}
        </div>
      </div>

      <div className="suggestions">
        {dataset.suggestions.map((s, i) => (
          <button key={s} className="suggestion" onClick={() => onAsk(s)} style={{ animationDelay: `${i * 50}ms` }}>
            <span>{s}</span>
            <ArrowUpRight size={16} />
          </button>
        ))}
      </div>

      {!llm && (
        <p className="empty-note">
          Running on the offline demo engine: it handles totals, averages, rates, trends, top-N, filters and comparisons.
          Connect the AI engine to unlock open-ended questions, multi-table joins and self-correcting queries.
        </p>
      )}

      <button className="empty-upload" onClick={onAdd}>
        <Upload size={16} /> Have your own data? Upload a CSV, Excel or SQLite file, or connect Postgres/MySQL
      </button>
    </div>
  );
}
