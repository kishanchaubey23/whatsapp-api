'use client';

import AuthGuard from '@/components/AuthGuard';
import DashboardShell from '@/components/DashboardShell';
import TemplatesPanel from '@/components/TemplatesPanel';

export default function TemplatesPage() {
  return (
    <AuthGuard>
      <DashboardShell>
        <TemplatesPanel />
      </DashboardShell>
    </AuthGuard>
  );
}
