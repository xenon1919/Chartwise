import { useEffect, useRef } from 'react';
import { ArrowUp } from 'lucide-react';

export default function Composer({ value, onChange, onSubmit, busy, dataset }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  useEffect(() => {
    if (value) ref.current?.focus();
  }, [value]);

  const submit = (e) => {
    e?.preventDefault();
    if (value.trim() && !busy) onSubmit(value);
  };

  return (
    <form className="composer" onSubmit={submit}>
      <div className="composer-box">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          placeholder={dataset ? `Ask anything about ${dataset.name}…` : 'Pick a dataset to start…'}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
          }}
          aria-label="Ask a question about your data"
          maxLength={1000}
        />
        <button type="submit" className="send-btn" disabled={!value.trim() || busy} aria-label="Send">
          {busy ? <span className="spinner small" /> : <ArrowUp size={18} />}
        </button>
      </div>
      <p className="composer-hint">
        <kbd>Enter</kbd> to ask · <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line · Queries are read-only
      </p>
    </form>
  );
}
