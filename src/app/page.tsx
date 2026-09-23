'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

/** App entry: authenticated users → dashboard, others → login */
export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/dashboard' : '/login');
  }, [user, loading, router]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#0b1220',
        color: '#94a3b8',
        fontFamily: "'Comic Relief', cursive, system-ui, sans-serif",
      }}
    >
      <p>Loading WhatsFlow…</p>
    </div>
  );
}
