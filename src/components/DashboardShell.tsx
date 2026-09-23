'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import '@/app/dashboard/dashboard.css';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', sub: 'Overview & Analytics', icon: 'home' },
  { href: '/dashboard/devices', label: 'Devices', sub: 'WhatsApp Sessions', icon: 'device' },
  { href: '/dashboard/templates', label: 'Templates', sub: 'Message Templates', icon: 'template' },
  { href: '/dashboard/contacts', label: 'Contacts', sub: 'Contact Management', icon: 'contacts' },
  { href: '/dashboard/bulk', label: 'Bulk Messages', sub: 'Mass Messaging', icon: 'bulk' },
  { href: '/dashboard/auto-reply', label: 'Auto Reply', sub: 'Keyword responses', icon: 'autoreply' },
  { href: '/dashboard/warmer', label: 'Warmer', sub: 'Warm up numbers', icon: 'warmer' },
  { href: '/dashboard/opt-out', label: 'Opt-Out Management', sub: 'Requests & preferences', icon: 'optout' },
] as const;

function NavIcon({ name }: { name: string }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 } as const;
  switch (name) {
    case 'home':
      return (
        <svg {...common} aria-hidden>
          <path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z" strokeLinejoin="round" />
        </svg>
      );
    case 'device':
      return (
        <svg {...common} aria-hidden>
          <rect x="7" y="2.5" width="10" height="19" rx="2" />
          <path d="M11 18h2" strokeLinecap="round" />
        </svg>
      );
    case 'send':
      return (
        <svg {...common} aria-hidden>
          <path d="M4 12L20 4l-6 16-2-7-8-1z" strokeLinejoin="round" />
        </svg>
      );
    case 'template':
      return (
        <svg {...common} aria-hidden>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M8 8h8M8 12h8M8 16h5" strokeLinecap="round" />
        </svg>
      );
    case 'contacts':
      return (
        <svg {...common} aria-hidden>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" strokeLinecap="round" />
          <path d="M16 8a2.5 2.5 0 0 1 0 5M16 14.5c2 0 3.5 1.2 3.5 3" strokeLinecap="round" />
        </svg>
      );
    case 'bulk':
      return (
        <svg {...common} aria-hidden>
          <path d="M4 7h12M4 12h16M4 17h10" strokeLinecap="round" />
        </svg>
      );
    case 'autoreply':
      return (
        <svg {...common} aria-hidden>
          <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V16H6.5A2.5 2.5 0 0 1 4 13.5v-7z" strokeLinejoin="round" />
          <path d="M8 9h8M8 12h5" strokeLinecap="round" />
        </svg>
      );
    case 'warmer':
      return (
        <svg {...common} aria-hidden>
          <path d="M12 3v10M12 13c-2.5 0-4 1.8-4 4a4 4 0 0 0 8 0c0-2.2-1.5-4-4-4z" strokeLinejoin="round" />
        </svg>
      );
    case 'optout':
      return (
        <svg {...common} aria-hidden>
          <circle cx="12" cy="12" r="8" />
          <path d="M8 12h8" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('whatsflow_dash_theme');
      if (saved === 'dark' || saved === 'light') setTheme(saved);
    } catch {
      /* ignore */
    }
  }, []);

  function toggleTheme() {
    setTheme((t) => {
      const next = t === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem('whatsflow_dash_theme', next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const initials = useMemo(() => {
    const n = user?.name?.trim() || user?.email || 'U';
    return n
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || '')
      .join('') || 'U';
  }, [user]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <div className={`wf-app ${theme === 'dark' ? 'theme-dark' : 'theme-light'} ${open ? 'sidebar-open' : ''}`}>
      {open && <div className="wf-sidebar-overlay" onClick={() => setOpen(false)} aria-hidden />}

      <aside className="wf-sidebar">
        <Link href="/dashboard" className="wf-sidebar-brand" onClick={() => setOpen(false)}>
          <span className="wf-sidebar-logo" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src="/logo.svg" alt="Loopx" width={26} height={26} />
          </span>
          <span className="wf-sidebar-brand-text">
            <strong>
              Loop<span>x</span>
            </strong>
            <small>powered by Loopanda</small>
          </span>
        </Link>

        <nav className="wf-nav" aria-label="Main">
          {NAV.map((item) => {
            const active =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <button
                key={item.href}
                type="button"
                className={`wf-nav-item ${active ? 'active' : ''}`}
                onClick={() => go(item.href)}
              >
                <span className="wf-nav-icon">
                  <NavIcon name={item.icon} />
                </span>
                <span className="wf-nav-item-copy">
                  <strong>{item.label}</strong>
                  <span>{item.sub}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="wf-sidebar-foot">
          <div className="wf-sidebar-user">
            <div className="wf-avatar">{initials}</div>
            <div className="wf-sidebar-user-meta">
              <strong>{user?.name || 'User'}</strong>
              <span>{user?.email}</span>
            </div>
          </div>
          <button type="button" className="wf-signout" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="wf-main">
        <header className="wf-topbar">
          <button type="button" className="wf-mobile-menu" aria-label="Open menu" onClick={() => setOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </button>

          <div className="wf-topbar-title">
            <strong>Dashboard</strong>
            <span>v2.0.0 · Enterprise</span>
          </div>

          <label className="wf-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search modules, contacts, templates…"
              aria-label="Search"
            />
          </label>

          <div className="wf-topbar-actions">
            <button
              type="button"
              className="wf-icon-btn"
              aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              title={theme === 'light' ? 'Dark mode' : 'Light mode'}
              onClick={toggleTheme}
            >
              {theme === 'light' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M20 14.5A7.5 7.5 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" strokeLinecap="round" />
                </svg>
              )}
            </button>
            <button type="button" className="wf-icon-btn" aria-label="Notifications" title="Notifications">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 7H3s3 0 3-7" strokeLinejoin="round" />
                <path d="M10 19a2 2 0 0 0 4 0" strokeLinecap="round" />
              </svg>
            </button>
            <span className="wf-plan-chip">₹5,000 · Enterprise</span>
          </div>
        </header>

        <div className="wf-content">{children}</div>
      </div>
    </div>
  );
}
