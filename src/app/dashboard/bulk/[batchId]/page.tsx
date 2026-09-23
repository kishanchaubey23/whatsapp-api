'use client';

import { use } from 'react';
import AuthGuard from '@/components/AuthGuard';
import DashboardShell from '@/components/DashboardShell';
import CampaignProgress from '@/components/bulk/CampaignProgress';

export default function BulkBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = use(params);
  return (
    <AuthGuard>
      <DashboardShell>
        <CampaignProgress batchId={batchId} />
      </DashboardShell>
    </AuthGuard>
  );
}
