import { useEffect, useRef, useState } from 'react';
import {
  BarChart3, LineChart, AreaChart, PieChart, ScatterChart, Table2, Gauge, BarChartHorizontal, Copy, Check, Pencil, Play,
  Download, ImageDown, Sparkles, WifiOff, User, RefreshCw, Timer, Rows3, AlertTriangle, CornerDownRight, Database, Code2,
} from 'lucide-react';
import ChartView, { availableTypes } from './ChartView.jsx';
import { highlightSql } from '../../lib/sql.jsx';
import { humanize, formatCell, toCsv, download, slugify, richText } from '../../lib/format.jsx';

const TYPE_META = {
  bar: [BarChart3, 'Bar'], line: [LineChart, 'Line'], area: [AreaChart, 'Area'], pie: [PieChart, 'Donut'],
  scatter: [ScatterChart, 'Scatter'], histogram: [BarChartHorizontal, 'Histogram'], kpi: [Gauge, 'Number'], table: [Table2, 'Table'],
};

export function DataTable({ columns, rows, max = 500 }) {
  const numeric = columns.map((_, i) => rows.some((r) => typeof r[i] === 'number'));
  const shown = rows.slice(0, max);
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>{columns.map((c, i) => <th key={c} className={numeric[i] ? 'num' : ''} title={c}>{humanize(c)}</th>)}</tr>
        </thead>
        <tbody>
          {shown.map((r, ri) => (
            <tr key={ri}>{r.map((v, ci) => <td key={ci} className={numeric[ci] ? 'num' : ''}>{v === null ? <span className="null">null</span> : formatCell(v)}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="table-note">Showing the first {max.toLocaleString()} of {rows.length.toLocaleString()} rows — download the CSV for everything.</p>}
    </div>
  );
}

export function SqlPanel({ sql, onRun, startEditing = false }) {
  const [editing, setEditing] = useState(startEditing);
  const [text, setText] = useState(sql);
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const lines = sql.split('\n').length;

  useEffect(() => {
    setText(sql);
  }, [sql]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  const run = async () => {
    setRunning(true);
    setError('');
    const err = await onRun(text);
    setRunning(false);
    if (err) setError(err);
    else setEditing(false);
  };

  return (
    <div className={`sql-panel ${editing ? 'editing' : ''}`}>
      <div className="sql-head">
        <span className="sql-title"><Code2 size={14} /> Generated SQL</span>
        <div className="sql-actions">
          {!editing && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}</button>
              {onRun && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}><Pencil size={14} /> Edit &amp; run</button>}
            </>
          )}
          {editing && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setText(sql); setError(''); }}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={run} disabled={running || !text.trim()}>
                {running ? <span className="spinner small" /> : <Play size={14} />} Run query
              </button>
            </>
          )}
        </div>
      </div>
      {editing ? (
        <textarea
          className="sql-editor"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={Math.min(16, Math.max(5, text.split('\n').length + 1))}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); }}
          aria-label="Edit SQL"
        />
      ) : (
        <pre className={`sql-code ${!expanded && lines > 12 ? 'clamped' : ''}`}>{highlightSql(sql)}</pre>
      )}
      {!editing && lines > 12 && (
        <button className="sql-expand" onClick={() => setExpanded((e) => !e)}>{expanded ? 'Show less' : `Show all ${lines} lines`}</button>
      )}
      {editing && <p className="sql-tip">Only read-only SELECT queries run · <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to run</p>}
      {error && <p className="sql-error"><AlertTriangle size={14} /> {error}</p>}
    </div>
  );
}

function EngineBadge({ result }) {
  if (result.edited || result.engine === 'manual') return <span className="chip"><User size={12} /> Your SQL</span>;
  if (result.engine === 'claude') {
    return <span className="chip chip-accent"><Sparkles size={12} /> AI engine</span>;
  }
  return <span className="chip"><WifiOff size={12} /> Demo engine</span>;
}

export default function AnswerCard({ result, question, onFollowup, onRun, disabled }) {
  const types = availableTypes(result);
  const [type, setType] = useState(types.includes(result.chart.type) ? result.chart.type : types[0]);
  const chartRef = useRef(null);
  const name = slugify(result.chart.title || question);

  useEffect(() => {
    const t = availableTypes(result);
    setType(t.includes(result.chart.type) ? result.chart.type : t[0]);
  }, [result]);

  if (result.unanswerable) {
    return (
      <div className="answer-card">
        <div className="answer-body">
          <p className="unanswerable"><AlertTriangle size={16} /> {result.explanation}</p>
          {result.followups?.length > 0 && <Followups items={result.followups} onPick={onFollowup} disabled={disabled} />}
        </div>
      </div>
    );
  }

  const title = result.chart.title || humanize(result.chart.y?.[0] || 'Result');
  const canPng = !['table', 'kpi'].includes(type);

  return (
    <article className="answer-card">
      <header className="answer-head">
        <div className="answer-title">
          <h3>{title}</h3>
          <div className="meta">
            <EngineBadge result={result} />
            <span className="chip"><Rows3 size={12} /> {result.row_count.toLocaleString()}{result.truncated ? '+' : ''} row{result.row_count === 1 ? '' : 's'}</span>
            <span className="chip"><Timer size={12} /> {result.total_ms ? `${(result.total_ms / 1000).toFixed(result.total_ms < 1000 ? 2 : 1)}s` : `${result.elapsed_ms}ms`}</span>
            {result.attempts > 1 && <span className="chip chip-good" title="The first query failed and was repaired automatically"><RefreshCw size={12} /> Self-corrected</span>}
          </div>
        </div>
        <div className="view-switch" role="tablist" aria-label="Visualisation">
          {types.map((t) => {
            const [Icon, label] = TYPE_META[t];
            return (
              <button key={t} role="tab" aria-selected={type === t} className={type === t ? 'active' : ''} onClick={() => setType(t)} title={label}>
                <Icon size={15} /><span>{label}</span>
              </button>
            );
          })}
        </div>
      </header>

      {result.notice && <p className="notice"><AlertTriangle size={14} /> {result.notice}</p>}

      {result.insight && (
        <p className="insight"><Sparkles size={15} /><span>{richText(result.insight)}</span></p>
      )}

      <div className="viz">
        {type === 'table'
          ? <DataTable columns={result.columns} rows={result.rows} />
          : <ChartView ref={chartRef} result={result} type={type} />}
      </div>

      <div className="answer-body">
        {result.explanation && <p className="explanation"><Database size={14} /> {result.explanation}</p>}
        {result.sql && <SqlPanel sql={result.sql} onRun={onRun} />}

        <div className="answer-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => download(`${name}.csv`, toCsv(result.columns, result.rows))}>
            <Download size={14} /> CSV
          </button>
          {canPng && (
            <button className="btn btn-ghost btn-sm" onClick={() => chartRef.current?.downloadPng(name)}>
              <ImageDown size={14} /> PNG
            </button>
          )}
          {result.truncated && <span className="muted-note">Results capped at {result.row_count.toLocaleString()} rows</span>}
        </div>

        {result.followups?.length > 0 && <Followups items={result.followups} onPick={onFollowup} disabled={disabled} />}
      </div>
    </article>
  );
}

function Followups({ items, onPick, disabled }) {
  return (
    <div className="followups">
      <span className="followups-label">Ask next</span>
      <div className="followups-list">
        {items.map((f) => (
          <button key={f} className="followup" onClick={() => onPick(f)} disabled={disabled}>
            <CornerDownRight size={13} /> {f}
          </button>
        ))}
      </div>
    </div>
  );
}

const STEPS = ['Reading the schema', 'Writing SQL', 'Running the query', 'Choosing a chart'];

export function LoadingCard({ engine }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const delays = engine === 'claude' ? [900, 2600, 1800] : [250, 350, 300];
    let i = 0;
    let t;
    const next = () => {
      if (i >= delays.length) return;
      t = setTimeout(() => { i += 1; setStep(i); next(); }, delays[i]);
    };
    next();
    return () => clearTimeout(t);
  }, [engine]);
  return (
    <div className="answer-card loading-card" aria-live="polite">
      <ol className="progress">
        {STEPS.map((s, i) => (
          <li key={s} className={i < step ? 'done' : i === step ? 'active' : ''}>
            <span className="progress-dot">{i < step ? <Check size={12} /> : i === step ? <span className="spinner tiny" /> : null}</span>
            {s}
          </li>
        ))}
      </ol>
      <div className="shimmer" />
    </div>
  );
}

export function ErrorCard({ message, sql, onRun }) {
  return (
    <div className="answer-card error-card">
      <p className="error-msg"><AlertTriangle size={16} /> {message}</p>
      {sql && <SqlPanel sql={sql} onRun={onRun} />}
      {!sql && <p className="error-tip">Try rephrasing with column names from the schema panel, or ask something simpler first.</p>}
    </div>
  );
}
