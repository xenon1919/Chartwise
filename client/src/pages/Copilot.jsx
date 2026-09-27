import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Home, PanelLeft, Sparkles, WifiOff, Zap, AlertTriangle } from 'lucide-react';
import Logo from '../components/Logo.jsx';
import Sidebar from '../components/copilot/Sidebar.jsx';
import Composer from '../components/copilot/Composer.jsx';
import AnswerCard, { LoadingCard, ErrorCard } from '../components/copilot/AnswerCard.jsx';
import EmptyState from '../components/copilot/EmptyState.jsx';
import AddDataModal from '../components/copilot/AddDataModal.jsx';
import PreviewModal from '../components/copilot/PreviewModal.jsx';
import { api } from '../lib/api.js';
import '../styles/copilot.css';

const store = {
  get(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  },
};

let turnSeq = 0;

export default function Copilot() {
  const [params, setParams] = useSearchParams();
  const [health, setHealth] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [activeId, setActiveId] = useState(params.get('dataset') || store.get('cw.dataset', 'ecommerce'));
  const [dataset, setDataset] = useState(null);
  const [threads, setThreads] = useState({});
  const [recent, setRecent] = useState([]);
  const [mode, setMode] = useState(store.get('cw.engine', 'auto'));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [draft, setDraft] = useState('');
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const wasDown = useRef(false);
  const scrollRef = useRef(null);
  const autoAsked = useRef(false);
  const busyRef = useRef(false);

  const turns = useMemo(() => threads[activeId] || [], [threads, activeId]);
  const busy = turns.some((t) => t.status === 'loading');
  busyRef.current = busy;

  const refreshDatasets = useCallback(async () => {
    const list = await api.datasets();
    setDatasets(list);
    return list;
  }, []);

  const connect = useCallback(async () => {
    try {
      setHealth(await api.health());
      const list = await refreshDatasets();
      setLoadError('');
      setActiveId((id) => (list.some((d) => d.id === id) || !list.length ? id : list[0].id));
      if (wasDown.current) setReloadKey((k) => k + 1);
      wasDown.current = false;
    } catch {
      wasDown.current = true;
      setHealth({ engine: 'down', llm: false });
    }
  }, [refreshDatasets]);

  useEffect(() => {
    connect();
  }, [connect]);

  // While the service is unreachable, keep checking so the page recovers on its own
  useEffect(() => {
    if (health?.engine !== 'down') return undefined;
    const t = setInterval(connect, 4000);
    return () => clearInterval(t);
  }, [health, connect]);

  useEffect(() => {
    if (!activeId) return;
    store.set('cw.dataset', activeId);
    setDataset(null);
    api.dataset(activeId).then(setDataset).catch(() => setDataset(null));
    api.history(activeId).then(setRecent).catch(() => setRecent([]));
  }, [activeId, reloadKey]);

  useEffect(() => {
    store.set('cw.engine', mode);
  }, [mode]);

  const scrollToBottom = () =>
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }));

  const updateTurn = (dsId, id, patch) =>
    setThreads((prev) => ({ ...prev, [dsId]: (prev[dsId] || []).map((t) => (t.id === id ? { ...t, ...patch } : t)) }));

  const ask = useCallback(async (question) => {
    const q = question.trim();
    if (!q || busyRef.current || !activeId) return;
    const dsId = activeId;
    const id = ++turnSeq;
    const history = (threads[dsId] || [])
      .filter((t) => t.status === 'done' && t.result?.sql)
      .slice(-4)
      .map((t) => ({ question: t.question, sql: t.result.sql }));
    setThreads((prev) => ({ ...prev, [dsId]: [...(prev[dsId] || []), { id, question: q, status: 'loading', startedAt: Date.now() }] }));
    setDraft('');
    setSidebarOpen(false);
    scrollToBottom();
    try {
      const result = await api.ask({ datasetId: dsId, question: q, history, engine: mode });
      updateTurn(dsId, id, { status: 'done', result });
      api.history(dsId).then(setRecent).catch(() => {});
    } catch (e) {
      updateTurn(dsId, id, { status: 'error', error: e.message, errorSql: e.sql });
    }
    requestAnimationFrame(() => document.getElementById(`turn-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [activeId, threads, mode]);

  const runSql = useCallback(async (turnId, sql) => {
    const dsId = activeId;
    try {
      const result = await api.run(dsId, sql);
      setThreads((prev) => ({
        ...prev,
        [dsId]: (prev[dsId] || []).map((t) => (t.id === turnId
          ? { ...t, status: 'done', error: null, result: { ...result, followups: t.result?.followups || [], edited: true } }
          : t)),
      }));
      return null;
    } catch (e) {
      return e.message;
    }
  }, [activeId]);

  // Deep links from the landing page: /app?dataset=saas&q=Churn%20rate%20by%20plan
  useEffect(() => {
    const q = params.get('q');
    if (!autoAsked.current && q && dataset && dataset.id === activeId) {
      autoAsked.current = true;
      setParams({}, { replace: true });
      ask(q);
    }
  }, [dataset, activeId, params, setParams, ask]);

  const selectDataset = (id) => {
    setActiveId(id);
    setSidebarOpen(false);
  };

  const onAdded = async (ds) => {
    await refreshDatasets();
    setAddOpen(false);
    selectDataset(ds.id);
  };

  const onRemove = async (id) => {
    await api.remove(id);
    const list = await refreshDatasets();
    setThreads((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (id === activeId) setActiveId(list[0]?.id);
  };

  const clearThread = () => setThreads((prev) => ({ ...prev, [activeId]: [] }));

  const engineDown = health && health.engine === 'down';
  const llm = !!health?.llm;
  const effectiveEngine = mode === 'demo' || (mode === 'auto' && !llm) ? 'demo' : 'claude';

  return (
    <div className={`copilot ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-btn only-mobile" onClick={() => setSidebarOpen((o) => !o)} aria-label="Toggle sidebar">
            <PanelLeft size={18} />
          </button>
          <Logo to="/" />
          <span className="crumb-sep">/</span>
          <span className="crumb">{dataset?.name || '…'}</span>
        </div>
        <div className="topbar-right">
          <div className="engine-switch" role="radiogroup" aria-label="Answer engine">
            {[
              ['auto', 'Auto', Zap],
              ['claude', 'AI', Sparkles],
              ['demo', 'Demo', WifiOff],
            ].map(([value, label, Icon]) => (
              <button
                key={value}
                role="radio"
                aria-checked={mode === value}
                className={mode === value ? 'active' : ''}
                disabled={value === 'claude' && !llm}
                title={value === 'claude' && !llm ? 'The AI engine is not configured yet' : value === 'auto' ? 'Uses the AI engine when available, otherwise the offline engine' : ''}
                onClick={() => setMode(value)}
              >
                <Icon size={13} /> <span>{label}</span>
              </button>
            ))}
          </div>
          <span className={`engine-status ${effectiveEngine}`} title={effectiveEngine === 'claude' ? 'AI engine' : 'Rule-based offline engine'}>
            <i /> {effectiveEngine === 'claude' ? 'AI engine' : 'Demo engine'}
          </span>
          <Link to="/" className="icon-btn" aria-label="Back to home"><Home size={17} /></Link>
        </div>
      </header>

      <div className="workspace">
        <Sidebar
          datasets={datasets}
          activeId={activeId}
          dataset={dataset}
          recent={recent}
          onSelect={selectDataset}
          onAdd={() => setAddOpen(true)}
          onRemove={onRemove}
          onAsk={ask}
          onInsert={(text) => setDraft((d) => (d ? `${d.trimEnd()} ${text}` : text))}
          onPreview={(table) => setPreview({ datasetId: activeId, table })}
        />
        <div className="scrim only-mobile" onClick={() => setSidebarOpen(false)} />

        <main className="main">
          {engineDown && (
            <div className="banner">
              <AlertTriangle size={16} />
              <span>Can't reach the analytics service. Make sure the app is running. This page reconnects automatically.</span>
              <button className="btn btn-ghost btn-sm banner-retry" onClick={connect}>Retry now</button>
            </div>
          )}
          {loadError && !engineDown && <div className="banner"><AlertTriangle size={16} /> {loadError}</div>}
          <div className="thread" ref={scrollRef}>
            <div className="thread-inner">
              {turns.length === 0 ? (
                <EmptyState dataset={dataset} llm={llm} onAsk={ask} onAdd={() => setAddOpen(true)} />
              ) : (
                <>
                  <div className="thread-head">
                    <span>{turns.length} question{turns.length === 1 ? '' : 's'} · follow-ups use earlier answers as context</span>
                    <button className="btn btn-ghost btn-sm" onClick={clearThread} disabled={busy}>New conversation</button>
                  </div>
                  {turns.map((t) => (
                    <section key={t.id} id={`turn-${t.id}`} className="turn">
                      <div className="question-bubble"><p>{t.question}</p></div>
                      {t.status === 'loading' && <LoadingCard engine={effectiveEngine} />}
                      {t.status === 'error' && <ErrorCard message={t.error} sql={t.errorSql} onRun={(sql) => runSql(t.id, sql)} />}
                      {t.status === 'done' && (
                        <AnswerCard
                          result={t.result}
                          question={t.question}
                          onFollowup={ask}
                          onRun={(sql) => runSql(t.id, sql)}
                          disabled={busy}
                        />
                      )}
                    </section>
                  ))}
                </>
              )}
            </div>
          </div>
          <Composer value={draft} onChange={setDraft} onSubmit={ask} busy={busy} dataset={dataset} />
        </main>
      </div>

      {addOpen && <AddDataModal onClose={() => setAddOpen(false)} onAdded={onAdded} />}
      {preview && <PreviewModal {...preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
