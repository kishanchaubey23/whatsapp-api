'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="wf-auth-loading">
        <div className="wf-spinner" />
        <p>Loading WhatsFlow…</p>
      </div>
    );
  }

  if (!user) return null;
  return <>{children}</>;
}
