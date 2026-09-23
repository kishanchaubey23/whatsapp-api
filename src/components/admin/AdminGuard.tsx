'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAdminToken } from '@/lib/admin-api';

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const t = getAdminToken();
    if (!t) {
      router.replace('/admin/login');
      return;
    }
    setOk(true);
  }, [router]);

  if (!ok) {
    return (
      <div className="adm-root" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <p style={{ color: '#64748b' }}>Checking admin session…</p>
      </div>
    );
  }

  return <>{children}</>;
}
