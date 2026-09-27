import { Link } from 'react-router-dom';
import { site } from '../config.js';

export function LogoMark({ className = 'logo-mark' }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b9dff" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="#111522" stroke="rgba(148,163,214,.25)" />
      <rect x="7" y="16" width="4" height="9" rx="1.5" fill="url(#logo-g)" />
      <rect x="14" y="11" width="4" height="14" rx="1.5" fill="url(#logo-g)" />
      <rect x="21" y="6" width="4" height="19" rx="1.5" fill="url(#logo-g)" />
    </svg>
  );
}

export default function Logo({ to = '/' }) {
  return (
    <Link to={to} className="logo" aria-label={`${site.product} home`}>
      <LogoMark />
      <span>{site.product}</span>
    </Link>
  );
}
