'use client';

export default function DashboardPlaceholder({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="wf-panel" style={{ minHeight: 360 }}>
      <div className="wf-panel-head">
        <h2>{title}</h2>
      </div>
      <div className="wf-empty">
        <div className="wf-empty-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <path d="M8 12h8M12 8v8" strokeLinecap="round" />
          </svg>
        </div>
        <strong>{title}</strong>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}
