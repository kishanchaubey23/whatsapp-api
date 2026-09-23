'use client';

import AuthGuard from '@/components/AuthGuard';
import DashboardShell from '@/components/DashboardShell';
import AutoReplyPanel from '@/components/AutoReplyPanel';

export default function AutoReplyPage() {
  return (
    <AuthGuard>
      <DashboardShell>
        <AutoReplyPanel />
      </DashboardShell>
    </AuthGuard>
  );
}
