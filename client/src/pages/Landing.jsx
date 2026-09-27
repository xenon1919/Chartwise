import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Sparkles, ShieldCheck, WifiOff, Database, MessageSquareText, BarChart3, Code2, RefreshCw,
  History, Download, FileSpreadsheet, Server, Layers, Cpu, Check, ShoppingBag, Rocket, Users, Github, Linkedin, Mail,
  LineChart, PieChart, ScatterChart, Table2, Gauge, Menu, X,
} from 'lucide-react';
import Logo from '../components/Logo.jsx';
import HeroDemo from '../components/landing/HeroDemo.jsx';
import { highlightSql } from '../lib/sql.jsx';
import { site } from '../config.js';
import '../styles/landing.css';

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal');
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))),
      { threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const links = [
    ['#how', 'How it works'],
    ['#features', 'Features'],
    ['#architecture', 'Under the hood'],
    ['#datasets', 'Try a dataset'],
  ];
  return (
    <nav className={`nav ${scrolled ? 'scrolled' : ''} ${open ? 'open' : ''}`}>
      <div className="container nav-inner">
        <Logo />
        <div className="nav-links">
          {links.map(([href, label]) => <a key={href} href={href} onClick={() => setOpen(false)}>{label}</a>)}
        </div>
        <div className="nav-cta">
          <Link to="/app" className="btn btn-primary btn-sm">Launch app <ArrowRight size={15} /></Link>
          <button className="icon-btn nav-toggle" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu">
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <header className="hero">
      <div className="hero-glow" aria-hidden="true" />
      <div className="hero-grid" aria-hidden="true" />
      <div className="container hero-inner">
        <div className="hero-copy">
          <span className="eyebrow reveal"><Sparkles size={14} /> AI analytics copilot for your business data</span>
          <h1 className="reveal">
            Ask your data <span className="serif">anything.</span>
            <br />
            Get the chart <span className="grad-text">and the SQL.</span>
          </h1>
          <p className="lead reveal">
            Connect a CSV, spreadsheet or live database and ask questions in plain English. {site.product} writes the
            query, runs it safely, picks the right chart and tells you what it means — in seconds.
          </p>
          <div className="hero-ctas reveal">
            <Link to="/app" className="btn btn-primary btn-lg">Launch the copilot <ArrowRight size={18} /></Link>
            <a href="#how" className="btn btn-ghost btn-lg">See how it works</a>
          </div>
          <ul className="trust reveal">
            <li><ShieldCheck size={15} /> Read-only by design</li>
            <li><WifiOff size={15} /> Offline demo mode</li>
            <li><Database size={15} /> SQLite · Postgres · MySQL</li>
          </ul>
        </div>
        <div className="hero-visual reveal">
          <HeroDemo />
        </div>
      </div>
    </header>
  );
}

function StackStrip() {
  const items = [
    ['CSV', 'files'], ['Excel', 'workbooks'], ['JSON', 'exports'], ['SQLite', 'databases'],
    ['PostgreSQL', 'live connection'], ['MySQL', 'live connection'], ['Charts', 'PNG export'], ['Results', 'CSV export'],
  ];
  return (
    <section className="stack-strip" aria-label="Supported data sources">
      <div className="marquee">
        {[...items, ...items].map(([name, role], i) => (
          <span key={i} className="stack-item"><strong>{name}</strong><em>{role}</em></span>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { icon: FileSpreadsheet, title: 'Connect your data', text: 'Drop in a CSV, Excel or SQLite file — or paste a Postgres/MySQL connection string. Columns are profiled automatically.' },
    { icon: MessageSquareText, title: 'Ask in plain English', text: '“Which region had the best Q4?” The copilot reads your schema, real column values and the conversation so far.' },
    { icon: BarChart3, title: 'Get chart + SQL + insight', text: 'A validated, read-only query runs against your data. You get the best-fit chart, the exact SQL and a one-line takeaway.' },
  ];
  return (
    <section id="how" className="section">
      <div className="container">
        <div className="section-head reveal">
          <span className="kicker">How it works</span>
          <h2>From question to chart in <span className="serif">three</span> steps</h2>
          <p>No dashboards to configure, no SQL to remember. Just ask.</p>
        </div>
        <div className="steps">
          {steps.map(({ icon: Icon, title, text }, i) => (
            <div key={title} className="step-card reveal" style={{ transitionDelay: `${i * 90}ms` }}>
              <div className="step-top">
                <span className="step-icon"><Icon size={20} /></span>
                <span className="step-num">0{i + 1}</span>
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const SAMPLE_SQL = `SELECT
  region,
  ROUND(SUM(revenue), 2) AS total_revenue
FROM ecommerce_orders
WHERE strftime('%Y', order_date) = '2025'
GROUP BY region
ORDER BY total_revenue DESC`;

function Features() {
  return (
    <section id="features" className="section">
      <div className="container">
        <div className="section-head reveal">
          <span className="kicker">Features</span>
          <h2>Built for people who want <span className="serif">answers</span>, not dashboards</h2>
          <p>Every answer is transparent, reproducible and safe to run on production data.</p>
        </div>
        <div className="bento">
          <article className="bento-card span-2 reveal">
            <div className="bento-text">
              <span className="bento-icon"><Code2 size={18} /></span>
              <h3>Transparent SQL, always</h3>
              <p>Every chart ships with the exact query behind it. Copy it, tweak it, re-run it inline — the copilot never hides its work.</p>
            </div>
            <pre className="bento-sql">{highlightSql(SAMPLE_SQL)}</pre>
          </article>
          <article className="bento-card reveal">
            <span className="bento-icon"><BarChart3 size={18} /></span>
            <h3>Picks the right chart</h3>
            <p>Trends become lines, rankings become bars, shares become donuts, relationships become scatters — and you can switch with one click.</p>
            <div className="chart-types">
              {[BarChart3, LineChart, PieChart, ScatterChart, Gauge, Table2].map((I, i) => <span key={i}><I size={16} /></span>)}
            </div>
          </article>
          <article className="bento-card reveal">
            <span className="bento-icon"><RefreshCw size={18} /></span>
            <h3>Self-correcting queries</h3>
            <p>If a generated query fails, the database error is fed back to the model and it repairs the SQL automatically.</p>
            <div className="retry-demo">
              <span className="chip chip-warn">no such column: sales</span>
              <ArrowRight size={14} />
              <span className="chip chip-good"><Check size={12} /> fixed → revenue</span>
            </div>
          </article>
          <article className="bento-card reveal">
            <span className="bento-icon"><ShieldCheck size={18} /></span>
            <h3>Read-only guardrails</h3>
            <p>Single-statement SELECTs only, blocked write keywords, read-only connections and row caps. Your data can't be modified.</p>
          </article>
          <article className="bento-card reveal">
            <span className="bento-icon"><History size={18} /></span>
            <h3>Remembers the conversation</h3>
            <p>Ask “now split that by channel” or “only for 2025” — follow-ups build on the previous query.</p>
          </article>
          <article className="bento-card reveal">
            <span className="bento-icon"><Layers size={18} /></span>
            <h3>Bring any data</h3>
            <p>CSV, TSV, Excel (multi-sheet), JSON, SQLite files and live Postgres/MySQL. Messy headers and “$1,200” values are cleaned on import.</p>
          </article>
          <article className="bento-card reveal">
            <span className="bento-icon"><Sparkles size={18} /></span>
            <h3>Insights, not just numbers</h3>
            <p>Each answer comes with a plain-English takeaway: the leader, the gap, the growth, the correlation.</p>
          </article>
          <article className="bento-card reveal">
            <span className="bento-icon"><Download size={18} /></span>
            <h3>Export anything</h3>
            <p>Download results as CSV, charts as PNG, or copy SQL straight into your BI tool.</p>
          </article>
        </div>
      </div>
    </section>
  );
}

function Architecture() {
  const nodes = [
    { icon: Layers, name: 'Conversational interface', tech: 'Ask · explore · export', text: 'Chat thread, one-click chart switching, schema explorer, CSV and PNG export.' },
    { icon: Server, name: 'Secure gateway', tech: 'Validate · limit · log', text: 'Input validation, rate limiting, file uploads and saved question history.' },
    { icon: Cpu, name: 'Analytics engine', tech: 'Profile · guard · run', text: 'Understands your schema, checks every query for safety, runs it and picks the chart.' },
  ];
  return (
    <section id="architecture" className="section">
      <div className="container">
        <div className="section-head reveal">
          <span className="kicker">Under the hood</span>
          <h2>A clean, <span className="serif">production-ready</span> design</h2>
          <p>Three focused layers with clear responsibilities, so each part can scale or change independently.</p>
        </div>
        <div className="arch reveal">
          {nodes.map(({ icon: Icon, name, tech, text }, i) => (
            <div className="arch-col" key={name}>
              <div className="arch-node">
                <span className="arch-icon"><Icon size={20} /></span>
                <h3>{name}</h3>
                <span className="arch-tech">{tech}</span>
                <p>{text}</p>
              </div>
              {i < nodes.length - 1 && <div className="arch-link" aria-hidden="true"><span /></div>}
            </div>
          ))}
          <div className="arch-col arch-targets">
            <div className="arch-link" aria-hidden="true"><span /></div>
            <div className="arch-stack">
              <div className="arch-node small">
                <span className="arch-icon"><Sparkles size={18} /></span>
                <h3>AI model</h3>
                <span className="arch-tech">Writes the SQL + chart plan</span>
              </div>
              <div className="arch-node small">
                <span className="arch-icon"><Database size={18} /></span>
                <h3>Your data</h3>
                <span className="arch-tech">Files or live databases</span>
              </div>
            </div>
          </div>
        </div>
        <ol className="flow reveal">
          <li><strong>Profile</strong> tables, types, ranges and real category values</li>
          <li><strong>Ask</strong> the AI model with your schema and conversation, and get back SQL plus a chart plan</li>
          <li><strong>Guard</strong> the SQL: single read-only SELECT, blocked keywords, row caps</li>
          <li><strong>Execute</strong>, and on error send it back for an automatic fix</li>
          <li><strong>Render</strong> an interactive chart and a plain-English insight</li>
        </ol>
      </div>
    </section>
  );
}

function Datasets() {
  const sets = [
    { id: 'ecommerce', icon: ShoppingBag, name: 'E-commerce Orders', meta: '6,000 orders · 13 columns', q: 'What is the monthly revenue trend?' },
    { id: 'saas', icon: Rocket, name: 'SaaS Customers', meta: '1,800 accounts · 13 columns', q: 'Churn rate by plan' },
    { id: 'hr', icon: Users, name: 'People Analytics', meta: '1,200 employees · 12 columns', q: 'Average salary by department' },
  ];
  return (
    <section id="datasets" className="section">
      <div className="container">
        <div className="section-head reveal">
          <span className="kicker">Try it now</span>
          <h2>Start with a <span className="serif">sample</span> dataset</h2>
          <p>Or upload your own inside the app. No sign-up required.</p>
        </div>
        <div className="datasets">
          {sets.map(({ id, icon: Icon, name, meta, q }, i) => (
            <Link key={id} to={`/app?dataset=${id}&q=${encodeURIComponent(q)}`} className="dataset-card reveal" style={{ transitionDelay: `${i * 90}ms` }}>
              <span className="dataset-icon"><Icon size={22} /></span>
              <h3>{name}</h3>
              <span className="dataset-meta">{meta}</span>
              <span className="dataset-q"><MessageSquareText size={14} /> “{q}”</span>
              <span className="dataset-go">Ask this <ArrowRight size={15} /></span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section className="section">
      <div className="container">
        <div className="cta-panel reveal">
          <div className="cta-glow" aria-hidden="true" />
          <h2>Your data already has the answers.<br /><span className="serif">Start asking.</span></h2>
          <p>Open the copilot, pick a dataset and ask your first question in under ten seconds.</p>
          <Link to="/app" className="btn btn-primary btn-lg">Launch the copilot <ArrowRight size={18} /></Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div>
          <Logo />
          <p className="footer-by">Designed &amp; built by <strong>{site.author}</strong> — {site.role}.</p>
        </div>
        <div className="footer-links">
          <a href={site.contactUrl} className="btn btn-ghost btn-sm"><Mail size={14} /> Hire me</a>
          <a href={site.githubUrl} target="_blank" rel="noreferrer" className="icon-btn" aria-label="GitHub"><Github size={18} /></a>
          <a href={site.linkedinUrl} target="_blank" rel="noreferrer" className="icon-btn" aria-label="LinkedIn"><Linkedin size={18} /></a>
        </div>
      </div>
    </footer>
  );
}

export default function Landing() {
  useReveal();
  return (
    <div className="landing">
      <Nav />
      <Hero />
      <StackStrip />
      <HowItWorks />
      <Features />
      <Architecture />
      <Datasets />
      <Cta />
      <Footer />
    </div>
  );
}
