import { useEffect, useState } from 'react';
import { Sparkles, Database, Code2, BarChart3 } from 'lucide-react';
import { highlightSql } from '../../lib/sql.jsx';

// Scripted walkthrough using real results from the bundled sample datasets.
const SCENES = [
  {
    dataset: 'ecommerce_orders',
    question: 'Show quarterly revenue for the last two years',
    sql: [
      'SELECT',
      "  strftime('%Y', order_date) || '-Q' || … AS quarter,",
      '  ROUND(SUM(revenue), 2) AS total_revenue',
      'FROM ecommerce_orders',
      'GROUP BY quarter ORDER BY quarter',
    ],
    chart: 'line',
    labels: ['24 Q1', 'Q2', 'Q3', 'Q4', '25 Q1', 'Q2', 'Q3', 'Q4'],
    values: [167, 199, 161, 277, 205, 217, 207, 340],
    insight: ['Revenue grew ', '+104%', ' — Q4 holiday peaks both years.'],
  },
  {
    dataset: 'saas_customers',
    question: 'Which plan has the highest churn rate?',
    sql: [
      'SELECT plan,',
      '  ROUND(AVG(churned) * 100, 1) AS churn_rate_pct',
      'FROM saas_customers',
      'GROUP BY plan',
      'ORDER BY churn_rate_pct DESC',
    ],
    chart: 'bar',
    labels: ['Starter', 'Growth', 'Business', 'Enterprise'],
    values: [21.2, 9.0, 5.2, 2.4],
    suffix: '%',
    insight: ['Starter churns ', '8.8×', ' faster than Enterprise.'],
  },
  {
    dataset: 'ecommerce_orders',
    question: 'Revenue share by sales channel',
    sql: [
      'SELECT channel,',
      '  ROUND(SUM(revenue), 2) AS total_revenue',
      'FROM ecommerce_orders',
      'GROUP BY channel',
      'ORDER BY total_revenue DESC',
    ],
    chart: 'bar',
    labels: ['Web', 'Mobile', 'Marketplace', 'Retail'],
    values: [736, 591, 307, 140],
    prefix: '$',
    suffix: 'K',
    insight: ['Web drives ', '42%', ' of revenue; mobile is close behind.'],
  },
];

const W = 460;
const H = 190;
const PAD = { l: 8, r: 8, t: 14, b: 26 };

function MiniChart({ scene, show }) {
  const max = Math.max(...scene.values) * 1.12;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const n = scene.values.length;

  if (scene.chart === 'line') {
    const pts = scene.values.map((v, i) => [PAD.l + (i / (n - 1)) * iw, PAD.t + ih - (v / max) * ih]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const area = `${d} L${pts[n - 1][0]},${PAD.t + ih} L${pts[0][0]},${PAD.t + ih} Z`;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className={`mini-chart ${show ? 'show' : ''}`} role="img" aria-label="Quarterly revenue line chart">
        <defs>
          <linearGradient id="area-g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3987e5" stopOpacity=".35" />
            <stop offset="1" stopColor="#3987e5" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <line key={g} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih * (1 - g)} y2={PAD.t + ih * (1 - g)} className="mini-grid" />
        ))}
        <path d={area} fill="url(#area-g)" className="mini-area" />
        <path d={d} className="mini-line" pathLength="1" />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="4" className="mini-dot" style={{ transitionDelay: `${0.25 + i * 0.09}s` }} />
        ))}
        {scene.labels.map((l, i) => (
          <text key={i} x={PAD.l + (i / (n - 1)) * iw} y={H - 6} className="mini-label" textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{l}</text>
        ))}
      </svg>
    );
  }

  const gap = 18;
  const bw = (iw - gap * (n - 1)) / n;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`mini-chart ${show ? 'show' : ''}`} role="img" aria-label="Bar chart">
      {[0.25, 0.5, 0.75, 1].map((g) => (
        <line key={g} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih * (1 - g)} y2={PAD.t + ih * (1 - g)} className="mini-grid" />
      ))}
      {scene.values.map((v, i) => {
        const h = (v / max) * ih;
        const x = PAD.l + i * (bw + gap);
        const y = PAD.t + ih - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={h} rx="4" className="mini-bar" style={{ transitionDelay: `${i * 0.08}s`, transformOrigin: `0 ${PAD.t + ih}px` }} />
            <text x={x + bw / 2} y={y - 6} textAnchor="middle" className="mini-value" style={{ transitionDelay: `${0.35 + i * 0.08}s` }}>
              {scene.prefix || ''}{v}{scene.suffix || ''}
            </text>
            <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="mini-label">{scene.labels[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function HeroDemo() {
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState(0);
  const [phase, setPhase] = useState('typing'); // typing → thinking → sql → chart
  const [sqlLines, setSqlLines] = useState(0);
  const scene = SCENES[idx];

  useEffect(() => {
    let t;
    if (phase === 'typing') {
      if (typed < scene.question.length) t = setTimeout(() => setTyped((n) => n + 1), 32 + Math.random() * 30);
      else t = setTimeout(() => setPhase('thinking'), 450);
    } else if (phase === 'thinking') {
      t = setTimeout(() => setPhase('sql'), 900);
    } else if (phase === 'sql') {
      if (sqlLines < scene.sql.length) t = setTimeout(() => setSqlLines((n) => n + 1), 170);
      else t = setTimeout(() => setPhase('chart'), 250);
    } else if (phase === 'chart') {
      t = setTimeout(() => {
        setIdx((i) => (i + 1) % SCENES.length);
        setTyped(0);
        setSqlLines(0);
        setPhase('typing');
      }, 4600);
    }
    return () => clearTimeout(t);
  }, [phase, typed, sqlLines, scene]);

  const step = { typing: 0, thinking: 1, sql: 2, chart: 3 }[phase];

  return (
    <div className="demo-window" aria-label="Animated product demo">
      <div className="demo-bar">
        <span className="dots"><i /><i /><i /></span>
        <span className="demo-url"><Database size={13} /> {scene.dataset}</span>
        <span className="demo-engine"><Sparkles size={12} /> AI</span>
      </div>
      <div className="demo-body">
        <div className="demo-question">
          <span className="demo-avatar">You</span>
          <p>
            {scene.question.slice(0, typed)}
            {phase === 'typing' && <span className="caret" />}
          </p>
        </div>

        <div className="demo-steps">
          {['Reading schema', 'Writing SQL', 'Drawing chart'].map((s, i) => (
            <span key={s} className={`demo-step ${step > i ? 'done' : ''} ${step === i + 1 ? 'active' : ''}`}>
              {i === 0 ? <Database size={12} /> : i === 1 ? <Code2 size={12} /> : <BarChart3 size={12} />} {s}
            </span>
          ))}
        </div>

        <div className={`demo-answer ${step >= 2 ? 'visible' : ''}`}>
          <pre className="demo-sql">
            {scene.sql.slice(0, sqlLines).map((line, i) => (
              <div key={`${idx}-${i}`} className="sql-line">{highlightSql(line)}</div>
            ))}
          </pre>
          <div className="demo-chart">
            <MiniChart key={idx} scene={scene} show={phase === 'chart'} />
          </div>
          <p className={`demo-insight ${phase === 'chart' ? 'show' : ''}`}>
            <Sparkles size={14} />
            <span>{scene.insight[0]}<strong>{scene.insight[1]}</strong>{scene.insight[2]}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
