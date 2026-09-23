'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminApi, setAdminToken } from '@/lib/admin-api';
import '@/app/admin/admin.css';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('uselesswebster@gmail.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await adminApi.login(email.trim(), password);
      setAdminToken(res.token);
      router.replace('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-root">
      <div className="adm-login-wrap">
        <form className="adm-login-card" onSubmit={onSubmit}>
          <h1>Admin Login</h1>
          <p>WhatsFlow control panel — authorized staff only.</p>
          {error && <div className="adm-login-error">{error}</div>}
          <label htmlFor="adm-email">Email</label>
          <input
            id="adm-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label htmlFor="adm-pass">Password</label>
          <input
            id="adm-pass"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
