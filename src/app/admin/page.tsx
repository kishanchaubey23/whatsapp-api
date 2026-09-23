'use client';

import { useEffect, useState } from 'react';
import AdminGuard from '@/components/admin/AdminGuard';
import AdminShell from '@/components/admin/AdminShell';
import { adminApi, type AdminStats } from '@/lib/admin-api';

function DashboardBody() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await adminApi.stats();
        setStats(res.stats);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load stats');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <>
      <h1>Admin Dashboard</h1>
      <p className="sub">Platform-wide overview across all tenants.</p>
      {error && <div className="adm-error">{error}</div>}
      {loading && <p className="sub">Loading stats…</p>}
      {stats && (
        <>
          <div className="adm-stats">
            <div className="adm-stat">
              <span>Total users</span>
              <strong>{stats.users.total}</strong>
            </div>
            <div className="adm-stat green">
              <span>Active users (plan on)</span>
              <strong>{stats.users.active}</strong>
            </div>
            <div className="adm-stat red">
              <span>Banned / terminated WA users</span>
              <strong>{stats.users.withBannedWhatsApp}</strong>
            </div>
            <div className="adm-stat amber">
              <span>Inactive / plan off</span>
              <strong>{stats.users.inactiveOrPlanOff}</strong>
            </div>
          </div>

          <div className="adm-stats">
            <div className="adm-stat blue">
              <span>Successful messages</span>
              <strong>{stats.messages.successful}</strong>
            </div>
            <div className="adm-stat green">
              <span>Blast sent (counters)</span>
              <strong>{stats.messages.blastSent}</strong>
            </div>
            <div className="adm-stat red">
              <span>Failed messages</span>
              <strong>{stats.messages.failed}</strong>
            </div>
            <div className="adm-stat amber">
              <span>Blast failed</span>
              <strong>{stats.messages.blastFailed}</strong>
            </div>
            <div className="adm-stat">
              <span>Pending messages</span>
              <strong>{stats.messages.pending}</strong>
            </div>
            <div className="adm-stat">
              <span>Total blast recipients</span>
              <strong>{stats.messages.blastTotal}</strong>
            </div>
            <div className="adm-stat">
              <span>Campaign batches</span>
              <strong>{stats.campaigns.totalBatches}</strong>
            </div>
            <div className="adm-stat red">
              <span>Banned WA accounts</span>
              <strong>{stats.whatsapp.bannedOrTerminatedAccounts}</strong>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default function AdminHomePage() {
  return (
    <AdminGuard>
      <AdminShell>
        <DashboardBody />
      </AdminShell>
    </AdminGuard>
  );
}
