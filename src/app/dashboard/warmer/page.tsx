'use client';

import AuthGuard from '@/components/AuthGuard';
import DashboardShell from '@/components/DashboardShell';
import DashboardPlaceholder from '@/components/DashboardPlaceholder';

export default function WarmerPage() {
  return (
    <AuthGuard>
      <DashboardShell>
        <DashboardPlaceholder
          title="Warmer"
          subtitle="Warm up WhatsApp numbers with automated conversations. Coming next."
        />
      </DashboardShell>
    </AuthGuard>
  );
}
