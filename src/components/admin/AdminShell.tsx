'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { setAdminToken } from '@/lib/admin-api';
import '@/app/admin/admin.css';

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  function logout() {
    setAdminToken(null);
    router.replace('/admin/login');
  }

  return (
    <div className="adm-root">
      <div className="adm-shell">
        <aside className="adm-side">
          <div className="brand">
            Whats<span>Flow</span> Admin
          </div>
          <Link href="/admin" className={pathname === '/admin' ? 'active' : ''}>
            Dashboard
          </Link>
          <Link
            href="/admin/users"
            className={pathname?.startsWith('/admin/users') ? 'active' : ''}
          >
            Users
          </Link>
          <button type="button" className="nav" onClick={logout}>
            Sign out
          </button>
          <div className="side-foot">Enterprise control panel</div>
        </aside>
        <main className="adm-main">{children}</main>
      </div>
    </div>
  );
}
