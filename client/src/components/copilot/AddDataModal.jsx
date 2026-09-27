import { useEffect, useRef, useState } from 'react';
import { X, UploadCloud, Link2, FileSpreadsheet, AlertTriangle, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api.js';

export function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const ACCEPT = '.csv,.tsv,.txt,.xlsx,.xls,.json,.db,.sqlite,.sqlite3';

export default function AddDataModal({ onClose, onAdded }) {
  const [tab, setTab] = useState('upload');
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef(null);

  const pick = (f) => {
    if (!f) return;
    setError('');
    setFile(f);
    if (!name) setName(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const ds = tab === 'upload' ? await api.upload(file, name.trim()) : await api.connect(url.trim(), name.trim() || undefined);
      onAdded(ds);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add your data" onClose={onClose}>
      <div className="tabs">
        <button className={tab === 'upload' ? 'active' : ''} onClick={() => { setTab('upload'); setError(''); }}><UploadCloud size={15} /> Upload a file</button>
        <button className={tab === 'connect' ? 'active' : ''} onClick={() => { setTab('connect'); setError(''); }}><Link2 size={15} /> Connect a database</button>
      </div>
      <form onSubmit={submit} className="modal-body">
        {tab === 'upload' ? (
          <>
            <div
              className={`dropzone ${drag ? 'drag' : ''} ${file ? 'has-file' : ''}`}
              onClick={() => input.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            >
              <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => pick(e.target.files?.[0])} />
              {file ? (
                <>
                  <FileSpreadsheet size={28} />
                  <strong>{file.name}</strong>
                  <span>{(file.size / 1024 / 1024).toFixed(2)} MB · click to choose another</span>
                </>
              ) : (
                <>
                  <UploadCloud size={30} />
                  <strong>Drop a file here or click to browse</strong>
                  <span>CSV, TSV, Excel, JSON or SQLite · up to 50 MB</span>
                </>
              )}
            </div>
            <label className="field">
              <span>Dataset name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 Sales" maxLength={80} />
            </label>
          </>
        ) : (
          <>
            <label className="field">
              <span>Connection string</span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="postgresql://user:password@host:5432/database"
                spellCheck={false}
                autoComplete="off"
                className="mono"
              />
            </label>
            <div className="examples">
              {['postgresql://user:pass@localhost:5432/shop', 'mysql://user:pass@localhost:3306/shop', 'sqlite:///C:/data/sales.db'].map((ex) => (
                <button type="button" key={ex} className="chip" onClick={() => setUrl(ex)}>{ex.split('://')[0]}</button>
              ))}
            </div>
            <label className="field">
              <span>Display name <em>(optional)</em></span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Production analytics" maxLength={80} />
            </label>
            <p className="safe-note"><ShieldCheck size={15} /> Tip: use a read-only database user. Queries are also validated as single SELECT statements and Postgres sessions run read-only.</p>
          </>
        )}
        {error && <p className="form-error"><AlertTriangle size={15} /> {error}</p>}
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || (tab === 'upload' ? !file : !url.trim())}>
            {busy ? <><span className="spinner small" /> {tab === 'upload' ? 'Profiling data…' : 'Connecting…'}</> : tab === 'upload' ? 'Upload & analyse' : 'Connect'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
