'use client';

import AuthGuard from '@/components/AuthGuard';
import DashboardShell from '@/components/DashboardShell';
import DevicesPanel from '@/components/DevicesPanel';

export default function DevicesPage() {
  return (
    <AuthGuard>
      <DashboardShell>
        <DevicesPanel />
      </DashboardShell>
    </AuthGuard>
  );
}
