'use client';

import AuthGuard from '@/components/AuthGuard';
import DashboardShell from '@/components/DashboardShell';
import ContactsPanel from '@/components/ContactsPanel';

export default function ContactsPage() {
  return (
    <AuthGuard>
      <DashboardShell>
        <ContactsPanel />
      </DashboardShell>
    </AuthGuard>
  );
}
