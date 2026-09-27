import { useState } from 'react';
import {
  Plus, ShoppingBag, Rocket, Users, FileSpreadsheet, Server, Database, ChevronRight, Hash, Calendar, Tag,
  ToggleLeft, Type, Eye, Trash2, Clock, Table2,
} from 'lucide-react';

const DS_ICONS = { 'shopping-bag': ShoppingBag, rocket: Rocket, users: Users, file: FileSpreadsheet, server: Server };
const KIND_ICONS = { numeric: Hash, date: Calendar, category: Tag, boolean: ToggleLeft, text: Type };
const KIND_LABEL = { numeric: 'Number', date: 'Date', category: 'Category', boolean: 'Yes / no flag', text: 'Text' };

function compact(n) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(n);
}

function columnHint(c) {
  if (c.kind === 'category' && c.values?.length) return `${c.values.length} values · e.g. ${c.values.slice(0, 3).join(', ')}`;
  if ((c.kind === 'numeric' || c.kind === 'date') && c.min != null) {
    const f = (v) => (typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v);
    return `${f(c.min)} → ${f(c.max)}`;
  }
  return KIND_LABEL[c.kind];
}

export default function Sidebar({ datasets, activeId, dataset, recent, onSelect, onAdd, onRemove, onAsk, onInsert, onPreview }) {
  const [openTables, setOpenTables] = useState({});
  const [confirming, setConfirming] = useState(null);
  const samples = datasets.filter((d) => d.source === 'sample');
  const mine = datasets.filter((d) => d.source !== 'sample');
  const tables = dataset?.tables || [];
  const isOpen = (name, i) => openTables[name] ?? i === 0;

  const DsItem = (d) => {
    const Icon = DS_ICONS[d.icon] || Database;
    return (
      <div key={d.id} className={`ds-item ${d.id === activeId ? 'active' : ''}`}>
        <button className="ds-main" onClick={() => onSelect(d.id)}>
          <span className="ds-icon"><Icon size={15} /></span>
          <span className="ds-text">
            <span className="ds-name">{d.name}</span>
            <span className="ds-meta">{compact(d.row_count)} rows · {d.tables.length} table{d.tables.length === 1 ? '' : 's'}</span>
          </span>
        </button>
        {d.source !== 'sample' && (
          confirming === d.id ? (
            <span className="ds-confirm">
              <button onClick={() => { setConfirming(null); onRemove(d.id); }}>Remove</button>
              <button onClick={() => setConfirming(null)}>Keep</button>
            </span>
          ) : (
            <button className="icon-btn ds-remove" onClick={() => setConfirming(d.id)} aria-label={`Remove ${d.name}`}><Trash2 size={14} /></button>
          )
        )}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        <button className="btn btn-primary add-btn" onClick={onAdd}><Plus size={16} /> Add your data</button>

        <div className="side-section">
          <h4>Sample datasets</h4>
          {samples.map(DsItem)}
        </div>

        {mine.length > 0 && (
          <div className="side-section">
            <h4>Your data</h4>
            {mine.map(DsItem)}
          </div>
        )}

        <div className="side-section">
          <h4>Schema <span className="side-hint">click a column to use it</span></h4>
          {!dataset && <div className="skeleton-list">{[0, 1, 2, 3].map((i) => <span key={i} />)}</div>}
          {tables.map((t, i) => (
            <div key={t.name} className="schema-table">
              <div className="schema-table-head">
                <button className="schema-toggle" onClick={() => setOpenTables((o) => ({ ...o, [t.name]: !isOpen(t.name, i) }))}>
                  <ChevronRight size={14} className={isOpen(t.name, i) ? 'rot' : ''} />
                  <Table2 size={14} />
                  <span className="schema-name">{t.name}</span>
                  <span className="schema-count">{compact(t.row_count)}</span>
                </button>
                <button className="icon-btn" onClick={() => onPreview(t.name)} aria-label={`Preview ${t.name}`} title="Preview rows"><Eye size={14} /></button>
              </div>
              {isOpen(t.name, i) && (
                <ul className="columns">
                  {t.columns.map((c) => {
                    const Icon = KIND_ICONS[c.kind] || Type;
                    return (
                      <li key={c.name}>
                        <button onClick={() => onInsert(c.name.replace(/_/g, ' '))} title={columnHint(c)}>
                          <Icon size={13} className={`kind-${c.kind}`} />
                          <span className="col-name">{c.name}</span>
                          <span className="col-kind">{c.kind === 'boolean' ? 'flag' : c.kind}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>

        {recent.length > 0 && (
          <div className="side-section">
            <h4><Clock size={12} /> Recent questions</h4>
            <ul className="recent">
              {recent.slice(0, 8).map((r) => (
                <li key={r.at + r.question}><button onClick={() => onAsk(r.question)} title={r.question}>{r.question}</button></li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}
