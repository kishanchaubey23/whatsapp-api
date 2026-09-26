'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminGuard from '@/components/admin/AdminGuard';
import AdminShell from '@/components/admin/AdminShell';
import { adminApi, type AdminUserRow } from '@/lib/admin-api';

function UsersBody() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (query?: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await adminApi.users({ q: query, limit: 50 });
      setUsers(res.users);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function togglePlan(u: AdminUserRow) {
    const next = !u.planActive;
    const msg = next
      ? `Approve user & activate Enterprise Plan for ${u.email}?`
      : `Deactivate Enterprise Plan for ${u.email}? User will revert to Free Plan.`;
    if (!window.confirm(msg)) return;
    setBusyId(u.id);
    try {
      await adminApi.deactivatePlan(u.id, next, false);
      await load(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <h1>Users</h1>
      <p className="sub">{total} registered users</p>
      {error && <div className="adm-error">{error}</div>}

      <div className="adm-toolbar">
        <input
          placeholder="Search name, email, phone…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void load(q)}
        />
        <button type="button" onClick={() => void load(q)}>
          Search
        </button>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <div className="adm-card">
        {loading ? (
          <p className="sub">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="sub">No users found.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Login / contact</th>
                  <th>Registered</th>
                  <th>Last login</th>
                  <th>Plan</th>
                  <th>Account</th>
                  <th>WA</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.name}</strong>
                    </td>
                    <td>
                      <div>{u.email}</div>
                      {u.phone && <div style={{ color: '#64748b', fontSize: 12 }}>+{u.phone}</div>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                      {new Date(u.createdAt).toLocaleString()}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}
                    </td>
                    <td>
                      <span className={`adm-badge ${u.planActive && u.planCode === 'enterprise' ? 'on' : 'off'}`}>
                        {u.planActive && u.planCode === 'enterprise' ? 'Enterprise' : 'Free (Pending)'}
                      </span>
                    </td>
                    <td>
                      <span className={`adm-badge ${u.isActive ? 'on' : 'off'}`}>
                        {u.isActive ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td>
                      {u.hasBannedWhatsApp ? (
                        <span className="adm-badge warn">Banned WA</span>
                      ) : (
                        <span className="adm-badge on">{u.counts.whatsappAccounts} acct</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className={`adm-btn ${u.planActive ? 'danger' : 'ok'}`}
                        disabled={busyId === u.id}
                        onClick={() => void togglePlan(u)}
                      >
                        {u.planActive ? 'Deactivate to Free' : 'Approve & Activate'}
                      </button>
                      <Link href={`/admin/users/${u.id}`} className="adm-btn primary" style={{ display: 'inline-block' }}>
                        Action
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export default function AdminUsersPage() {
  return (
    <AdminGuard>
      <AdminShell>
        <UsersBody />
      </AdminShell>
    </AdminGuard>
  );
}
