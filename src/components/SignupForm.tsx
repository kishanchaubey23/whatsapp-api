'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Mail, Lock, User, Phone, ArrowRight } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export default function SignupForm() {
  const { register } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      await register(name.trim(), email.trim(), password, phone.trim() || undefined);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wf-login-page">
      <section className="wf-panel-form">
        <div className="wf-form-wrap">
          <div className="wf-brand">
            <span className="wf-brand-mark">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden>
                <rect width="40" height="40" rx="10" fill="#16A34A" />
                <path d="M11 20.5L28 11.5L23.5 28.5L18.5 22L11 20.5Z" fill="white" />
                <path d="M18.5 22L28 11.5L14.5 24L18.5 22Z" fill="#DCFCE7" />
              </svg>
            </span>
            <div className="wf-brand-text">
              <span className="wf-brand-name">Whats<span>Flow</span></span>
              <span className="wf-brand-tagline">Send Smarter. Grow Faster.</span>
            </div>
          </div>

          <div className="wf-heading">
            <h1>Create your account</h1>
            <p>Enterprise ₹5,000 — WhatsApp Business only. Profile checks included.</p>
          </div>

          <form className="wf-login-form" onSubmit={onSubmit}>
            {error && <div className="wf-login-error">{error}</div>}

            <div className="wf-field">
              <span className="wf-field-icon"><User size={18} color="#9CA3AF" /></span>
              <input type="text" required placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="wf-field">
              <span className="wf-field-icon"><Mail size={18} color="#9CA3AF" /></span>
              <input type="email" required placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="wf-field">
              <span className="wf-field-icon"><Phone size={18} color="#9CA3AF" /></span>
              <input type="tel" placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="wf-field">
              <span className="wf-field-icon"><Lock size={18} color="#9CA3AF" /></span>
              <input
                type={showPass ? 'text' : 'password'}
                required
                minLength={8}
                placeholder="Password (min 8 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" className="wf-field-action" onClick={() => setShowPass((v) => !v)}>
                {showPass ? <EyeOff size={18} color="#9CA3AF" /> : <Eye size={18} color="#9CA3AF" />}
              </button>
            </div>

            <button type="submit" className="wf-btn-primary" disabled={busy}>
              {busy ? 'Creating…' : <>Create account <ArrowRight size={18} color="white" /></>}
            </button>
          </form>

          <p className="wf-footer-text">
            Already have an account? <Link href="/login">Sign in</Link>
          </p>
        </div>
      </section>

      <section className="wf-panel-hero">
        <div className="wf-hero-copy">
          <h2>Built for <span>Business</span> WhatsApp.</h2>
          <p>We verify Business accounts and profile completeness before you send.</p>
        </div>
        <div className="wf-feature-row">
          <div className="wf-feature"><span style={{ color: '#16A34A', fontSize: 22 }}>✓</span><span>Business-only</span></div>
          <div className="wf-feature"><span style={{ color: '#16A34A', fontSize: 22 }}>✓</span><span>Profile checks</span></div>
          <div className="wf-feature"><span style={{ color: '#16A34A', fontSize: 22 }}>✓</span><span>Enterprise plan</span></div>
        </div>
      </section>
    </div>
  );
}
