'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminGuard from '@/components/admin/AdminGuard';
import AdminShell from '@/components/admin/AdminShell';
import { adminApi } from '@/lib/admin-api';

function UserDetailBody({ id }: { id: string }) {
  const [user, setUser] = useState<Awaited<ReturnType<typeof adminApi.user>>['user'] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminApi.user(id);
      setUser(res.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load user');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function deactivate(planActive: boolean) {
    if (!user) return;
    if (
      !window.confirm(
        planActive
          ? 'Activate this user plan?'
          : 'Deactivate plan and lock account login?',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await adminApi.deactivatePlan(user.id, planActive, !planActive);
      setToast(planActive ? 'Plan activated' : 'Plan deactivated');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function addPayment() {
    if (!user) return;
    setBusy(true);
    try {
      await adminApi.addPayment(user.id, {
        amountInr: user.planPriceInr || 5000,
        status: 'paid',
        method: 'manual',
        note: 'Enterprise plan — admin entry',
      });
      setToast('Payment recorded');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !user) {
    return <p className="sub">Loading user…</p>;
  }
  if (!user) {
    return (
      <>
        <Link href="/admin/users" className="adm-back">
          ← Users
        </Link>
        <div className="adm-error">{error || 'User not found'}</div>
      </>
    );
  }

  return (
    <>
      <Link href="/admin/users" className="adm-back">
        ← Users
      </Link>
      <h1>{user.name}</h1>
      <p className="sub">
        {user.email}
        {user.phone ? ` · +${user.phone}` : ''}
      </p>
      {error && <div className="adm-error">{error}</div>}
      {toast && (
        <div className="adm-error" style={{ background: '#ecfdf5', color: '#166534', border: '1px solid #bbf7d0' }}>
          {toast}
        </div>
      )}

      <div className="adm-meta">
        <div>
          <span>Registered</span>
          <strong>{new Date(user.createdAt).toLocaleString()}</strong>
        </div>
        <div>
          <span>Last login</span>
          <strong>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—'}</strong>
        </div>
        <div>
          <span>Plan</span>
          <strong>
            {user.planCode} · ₹{user.planPriceInr} · {user.planActive ? 'ON' : 'OFF'}
          </strong>
        </div>
        <div>
          <span>Account</span>
          <strong>{user.isActive ? 'Enabled' : 'Disabled'}</strong>
        </div>
        <div>
          <span>Contacts</span>
          <strong>{user._count?.contacts ?? 0}</strong>
        </div>
        <div>
          <span>Messages</span>
          <strong>{user._count?.messages ?? 0}</strong>
        </div>
        <div>
          <span>Campaigns</span>
          <strong>{user._count?.blastBatches ?? 0}</strong>
        </div>
      </div>

      <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`adm-btn ${user.planActive ? 'danger' : 'ok'}`}
          disabled={busy}
          onClick={() => void deactivate(!user.planActive)}
        >
          {user.planActive ? 'Deactivate plan' : 'Activate plan'}
        </button>
        <button type="button" className="adm-btn ghost" disabled={busy} onClick={() => void addPayment()}>
          + Record payment (₹{user.planPriceInr || 5000})
        </button>
        <button type="button" className="adm-btn ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <div className="adm-detail-grid">
        <div className="adm-card">
          <h3>WhatsApp accounts used</h3>
          {user.whatsappAccounts?.length === 0 ? (
            <p className="sub">No WhatsApp accounts linked.</p>
          ) : (
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Risk</th>
                  <th>Last ready</th>
                </tr>
              </thead>
              <tbody>
                {user.whatsappAccounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.label}</strong>
                      {a.businessName && (
                        <div style={{ fontSize: 11, color: '#64748b' }}>{a.businessName}</div>
                      )}
                    </td>
                    <td>{a.phone ? `+${a.phone}` : '—'}</td>
                    <td>
                      <span
                        className={`adm-badge ${
                          a.status === 'ready' ? 'on' : a.status === 'banned' || a.status === 'session_terminated' ? 'off' : 'warn'
                        }`}
                      >
                        {a.status}
                      </span>
                    </td>
                    <td>{a.riskScore}</td>
                    <td style={{ fontSize: 12 }}>
                      {a.lastReadyAt ? new Date(a.lastReadyAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {user.whatsappAccounts?.some((a) => a.lastError) && (
            <p className="sub" style={{ marginTop: 10 }}>
              Latest errors may appear on banned/error accounts (admin view).
            </p>
          )}
        </div>

        <div className="adm-card">
          <h3>Payment history</h3>
          {user.payments?.length === 0 ? (
            <p className="sub">No payments recorded yet.</p>
          ) : (
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Method</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {user.payments.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontSize: 12 }}>
                      {p.paidAt
                        ? new Date(p.paidAt).toLocaleString()
                        : new Date(p.createdAt).toLocaleString()}
                    </td>
                    <td>
                      ₹{p.amountInr} {p.currency}
                    </td>
                    <td>
                      <span className={`adm-badge ${p.status === 'paid' ? 'on' : 'warn'}`}>{p.status}</span>
                    </td>
                    <td>{p.method || '—'}</td>
                    <td style={{ fontSize: 12 }}>{p.note || p.reference || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="adm-card" style={{ marginTop: 14 }}>
        <h3>Recent campaigns</h3>
        {user.blastBatches?.length === 0 ? (
          <p className="sub">No blast campaigns.</p>
        ) : (
          <table className="adm-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Status</th>
                <th>Kind</th>
                <th>Total</th>
                <th>Sent</th>
                <th>Failed</th>
              </tr>
            </thead>
            <tbody>
              {user.blastBatches.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontSize: 12 }}>{new Date(b.createdAt).toLocaleString()}</td>
                  <td>{b.status}</td>
                  <td>{b.kind}</td>
                  <td>{b.totalNumbers}</td>
                  <td>{b.sentCount}</td>
                  <td>{b.failedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {user.messageStats && Object.keys(user.messageStats).length > 0 && (
        <div className="adm-card" style={{ marginTop: 14 }}>
          <h3>Message status breakdown</h3>
          <div className="adm-stats">
            {Object.entries(user.messageStats).map(([k, v]) => (
              <div key={k} className="adm-stat">
                <span>{k}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <AdminGuard>
      <AdminShell>
        <UserDetailBody id={id} />
      </AdminShell>
    </AdminGuard>
  );
}
