'use client';

import AuthGuard from '@/components/AuthGuard';
import DashboardShell from '@/components/DashboardShell';
import DashboardPlaceholder from '@/components/DashboardPlaceholder';

export default function OptOutPage() {
  return (
    <AuthGuard>
      <DashboardShell>
        <DashboardPlaceholder
          title="Opt-Out Management"
          subtitle="Handle opt-out requests and preferences. Coming next."
        />
      </DashboardShell>
    </AuthGuard>
  );
}
