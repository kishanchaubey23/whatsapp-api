'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import DashboardShell from '@/components/DashboardShell';

/** Proxies removed from client nav — redirect to Auto Reply */
export default function ProxiesRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/auto-reply');
  }, [router]);

  return (
    <AuthGuard>
      <DashboardShell>
        <p style={{ color: '#64748b', padding: 24 }}>Redirecting to Auto Reply…</p>
      </DashboardShell>
    </AuthGuard>
  );
}
