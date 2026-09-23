'use client';

import AuthGuard from '@/components/AuthGuard';
import DashboardShell from '@/components/DashboardShell';
import DashboardHome from '@/components/DashboardHome';

export default function DashboardPage() {
  return (
    <AuthGuard>
      <DashboardShell>
        <DashboardHome />
      </DashboardShell>
    </AuthGuard>
  );
}
