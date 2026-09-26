'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

const STATS = [
  {
    label: 'Messages Sent',
    value: '0',
    foot: 'Total messages',
    color: '#3b82f6',
    bg: 'rgba(59,130,246,0.15)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.8">
        <path d="M4 6h16v10H7l-3 3V6z" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: 'Active Devices',
    value: '0',
    foot: '0 total sessions',
    color: '#22c55e',
    bg: 'rgba(34,197,94,0.15)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="1.8">
        <rect x="7" y="3" width="10" height="18" rx="2" />
        <path d="M11 17h2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: 'Total Contacts',
    value: '0',
    foot: 'All contacts',
    color: '#a855f7',
    bg: 'rgba(168,85,247,0.15)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="1.8">
        <circle cx="9" cy="8" r="3" />
        <path d="M4 19c0-3 2.2-5 5-5s5 2 5 5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: 'Templates',
    value: '0',
    foot: 'Active templates',
    color: '#f97316',
    bg: 'rgba(249,115,22,0.15)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="1.8">
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h5" strokeLinecap="round" />
      </svg>
    ),
  },
];

const ACTIONS = [
  { label: 'Send Bulk Message', href: '/dashboard/bulk', tone: 'blue', icon: 'msg' },
  { label: 'Add Device', href: '/dashboard/devices', tone: 'green', icon: 'device' },
  { label: 'Create Template', href: '/dashboard/templates', tone: 'orange', icon: 'doc' },
  { label: 'Import Contacts', href: '/dashboard/contacts', tone: 'purple', icon: 'people' },
  { label: 'Warmer', href: '/dashboard/warmer', tone: 'indigo', icon: 'chat' },
  { label: 'Reports', href: '/dashboard', tone: 'pink', icon: 'report' },
] as const;

function ActionIcon({ name }: { name: string }) {
  const p = { width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke: 'white', strokeWidth: 1.8 } as const;
  switch (name) {
    case 'msg':
      return (
        <svg {...p}>
          <path d="M4 6h16v10H8l-4 3V6z" strokeLinejoin="round" />
        </svg>
      );
    case 'device':
      return (
        <svg {...p}>
          <rect x="7" y="3" width="10" height="18" rx="2" />
        </svg>
      );
    case 'doc':
      return (
        <svg {...p}>
          <path d="M7 3h7l5 5v13H7V3z" strokeLinejoin="round" />
          <path d="M14 3v5h5" />
        </svg>
      );
    case 'people':
      return (
        <svg {...p}>
          <circle cx="9" cy="8" r="3" />
          <path d="M4 19c0-3 2-5 5-5s5 2 5 5" strokeLinecap="round" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...p}>
          <path d="M5 5h14v10H9l-4 3V5z" strokeLinejoin="round" />
        </svg>
      );
    case 'report':
      return (
        <svg {...p}>
          <path d="M5 19V9M10 19V5M15 19v-7M20 19V8" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}

export default function DashboardHome() {
  const { user } = useAuth();
  const router = useRouter();
  const first = user?.name?.split(/\s+/)[0] || 'there';

  return (
    <>
      <section className="wf-welcome">
        <div>
          <h1>Welcome back{first ? `, ${first}` : ''}!</h1>
          <p>Here&apos;s what&apos;s happening with your WhatsApp automation today.</p>
        </div>
        <div className="wf-welcome-icon" aria-hidden>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8">
            <path d="M4 6h16v10H8l-4 3V6z" strokeLinejoin="round" />
            <path d="M8 10h8M8 13h5" strokeLinecap="round" />
          </svg>
        </div>
      </section>

      {(!user?.plan?.active || user?.plan?.code !== 'enterprise') && (
        <section
          style={{
            background: '#fffbe3',
            border: '1px solid #fde68a',
            color: '#92400e',
            padding: '16px 20px',
            borderRadius: '12px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div>
            <strong style={{ fontSize: '15px', display: 'block', marginBottom: '4px' }}>
              Free Plan (Awaiting Admin Approval)
            </strong>
            <span style={{ fontSize: '13px', color: '#b45309' }}>
              Your account is registered on the Free Plan. Bulk sending privileges will be unlocked once an Admin approves your account in the Admin Panel.
            </span>
          </div>
        </section>
      )}

      <section className="wf-stats">
        {STATS.map((s) => (
          <article key={s.label} className="wf-stat-card">
            <div className="wf-stat-top">
              <span className="wf-stat-label">{s.label}</span>
              <span className="wf-stat-icon" style={{ background: s.bg }}>
                {s.icon}
              </span>
            </div>
            <div className="wf-stat-value">{s.value}</div>
            <div className="wf-stat-foot">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 14l5-5 4 4 7-7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M14 6h6v6" strokeLinecap="round" />
              </svg>
              {s.foot}
            </div>
          </article>
        ))}
      </section>

      <section className="wf-grid-2">
        <div className="wf-panel">
          <div className="wf-panel-head">
            <h2>Recent Activity</h2>
            <button type="button" className="wf-link-btn">
              View All
            </button>
          </div>
          <div className="wf-empty">
            <div className="wf-empty-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="8" />
                <path d="M12 8v4l3 2" strokeLinecap="round" />
              </svg>
            </div>
            <strong>No recent activities</strong>
            <p>Activities will appear here as you use the app</p>
          </div>
        </div>

        <div className="wf-panel">
          <div className="wf-panel-head">
            <h2>Quick Actions</h2>
          </div>
          <div className="wf-actions">
            {ACTIONS.map((a) => (
              <button
                key={a.label}
                type="button"
                className={`wf-action ${a.tone}`}
                onClick={() => router.push(a.href)}
              >
                <ActionIcon name={a.icon} />
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
