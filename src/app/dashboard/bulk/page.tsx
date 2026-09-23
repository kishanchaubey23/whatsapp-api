'use client';

import AuthGuard from '@/components/AuthGuard';
import DashboardShell from '@/components/DashboardShell';
import BulkCampaignPanel from '@/components/bulk/BulkCampaignPanel';

export default function BulkPage() {
  return (
    <AuthGuard>
      <DashboardShell>
        <BulkCampaignPanel />
      </DashboardShell>
    </AuthGuard>
  );
}
