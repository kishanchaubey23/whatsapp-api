'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import '@/app/login/styles.css';

type Mode = 'login' | 'signup';

function isPhone(value: string) {
  const digits = value.replace(/[\s\-\(\)\+]/g, '');
  return /^\d{7,15}$/.test(digits);
}

export default function AuthForm({ initialMode = 'login' }: { initialMode?: Mode }) {
  const { user, loading: authLoading, login, register } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPass, setShowPass] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = searchParams.get('mode');
    if (q === 'signup' || q === 'login') setMode(q);
  }, [searchParams]);

  // Already signed in → dashboard only
  useEffect(() => {
    if (!authLoading && user) {
      router.replace('/dashboard');
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('whatsflow_theme');
      if (saved === 'dark' || saved === 'light') setTheme(saved);
    } catch {
      /* ignore */
    }
  }, []);

  function setThemeMode(next: 'light' | 'dark') {
    setTheme(next);
    try {
      localStorage.setItem('whatsflow_theme', next);
    } catch {
      /* ignore */
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError('');
    setPassword('');
    const url = next === 'signup' ? '/login?mode=signup' : '/login';
    window.history.replaceState(null, '', url);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const raw = identity.trim();
    if (!raw) {
      setError('Enter your email or mobile number.');
      return;
    }
    if (password.length < 8 && mode === 'signup') {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'login') {
        if (isPhone(raw)) {
          setError('Phone login with OTP is coming soon. Please sign in with email for now.');
          setBusy(false);
          return;
        }
        await login(raw.toLowerCase(), password, remember);
      } else {
        // Signup → JWT issued immediately → dashboard (no second login)
        const phone = isPhone(raw) ? raw.replace(/[\s\-\(\)\+]/g, '') : undefined;
        const email = isPhone(raw)
          ? `${raw.replace(/\D/g, '')}@phone.whatsflow.local`
          : raw.toLowerCase();
        const name = isPhone(raw)
          ? `User ${phone!.slice(-4)}`
          : email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'WhatsFlow User';

        await register(name, email, password, phone);
      }
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === 'login' ? 'Sign in failed' : 'Sign up failed');
    } finally {
      setBusy(false);
    }
  }

  const isSignup = mode === 'signup';

  return (
    <div className={`wf-login-root ${theme === 'dark' ? 'is-dark' : ''}`}>
      <div className={`page ${isSignup ? 'is-signup' : 'is-login'}`}>
        {/* FORM PANEL */}
        <section className="panel panel-form">
          <div className="form-wrap">
            <div className="brand">
              <svg className="brand-mark" width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden>
                <rect width="40" height="40" rx="10" fill="#16A34A" />
                <path d="M11 20.5L28 11.5L23.5 28.5L18.5 22L11 20.5Z" fill="white" />
                <path d="M18.5 22L28 11.5L14.5 24L18.5 22Z" fill="#DCFCE7" />
              </svg>
              <div className="brand-text">
                <span className="brand-name">
                  Whats<span className="flow">Flow</span>
                </span>
                <span className="brand-tagline">Send Smarter. Grow Faster.</span>
              </div>
            </div>

            <div className="heading" key={mode}>
              {isSignup ? (
                <>
                  <h1>New Account</h1>
                  <p>Sign up with email or mobile. OTP verification coming soon.</p>
                </>
              ) : (
                <>
                  <h1>Welcome back!</h1>
                  <p>Sign in to your WhatsFlow account to continue.</p>
                </>
              )}
            </div>

            <form className="login-form" onSubmit={onSubmit} noValidate>
              {error ? <div className="login-error">{error}</div> : null}

              <div className="field">
                <svg className="field-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                  {isSignup ? (
                    <>
                      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M4 7L12 13L20 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="18" cy="18" r="4" fill="var(--white)" stroke="currentColor" strokeWidth="1.5" />
                    </>
                  ) : (
                    <>
                      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M4 7L12 13L20 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </>
                  )}
                </svg>
                <input
                  type="text"
                  id="identity"
                  name="identity"
                  placeholder={isSignup ? 'Email or mobile number' : 'Email address'}
                  autoComplete={isSignup ? 'username' : 'email'}
                  required
                  value={identity}
                  onChange={(e) => setIdentity(e.target.value)}
                />
              </div>

              <div className="field">
                <svg className="field-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M8 11V7.5C8 5.015 10.015 3 12.5 3S17 5.015 17 7.5V11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <circle cx="12" cy="16" r="1.5" fill="currentColor" />
                </svg>
                <input
                  type={showPass ? 'text' : 'password'}
                  id="password"
                  name="password"
                  placeholder="Password"
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  required
                  minLength={isSignup ? 8 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="field-action"
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPass((v) => !v)}
                >
                  {showPass ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M3 3L21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      <path d="M10.6 5.63C11.06 5.55 11.53 5.5 12 5.5C18.5 5.5 22 12 22 12C21.4 13.09 20.63 14.15 19.7 15.09M6.6 6.6C4.05 8.15 2 12 2 12C2 12 5.5 18.5 12 18.5C13.68 18.5 15.15 18.06 16.4 17.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M9.9 9.9C9.34 10.46 9 11.19 9 12C9 13.66 10.34 15 12 15C12.81 15 13.54 14.66 14.1 14.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M2 12C2 12 5.5 5.5 12 5.5S22 12 22 12 18.5 18.5 12 18.5 2 12 2 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                    </svg>
                  )}
                </button>
              </div>

              {!isSignup && (
                <div className="row-between">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                    />
                    <span className="checkbox-box">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M4 12.5L9.5 18L20 6" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    Remember me
                  </label>
                  <button
                    type="button"
                    className="link-muted"
                    onClick={() => setError('Contact support to reset your password.')}
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              {isSignup && (
                <p className="otp-hint">
                  We’ll add OTP verification for email &amp; mobile soon. For now, create your account and go straight to the dashboard.
                </p>
              )}

              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? (isSignup ? 'Creating…' : 'Signing in…') : (
                  <>
                    {isSignup ? 'Sign up' : 'Sign in'}
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M5 12H19" stroke="white" strokeWidth="2" strokeLinecap="round" />
                      <path d="M13 6L19 12L13 18" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </>
                )}
              </button>

              <div className="divider"><span>or continue with</span></div>

              <button
                type="button"
                className="btn-secondary"
                onClick={() => setError('Google sign-in coming soon. Use email or mobile for now.')}
              >
                <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
                  <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
                  <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
                  <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
                  <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
                </svg>
                Continue with Google
              </button>
            </form>

            <p className="footer-text">
              {isSignup ? (
                <>
                  Already have an account?{' '}
                  <button type="button" className="link-muted" onClick={() => switchMode('login')}>
                    Sign in
                  </button>
                </>
              ) : (
                <>
                  Don&apos;t have an account?{' '}
                  <button type="button" className="link-muted" onClick={() => switchMode('signup')}>
                    Create account
                  </button>
                  {' · '}
                  <a href="mailto:support@whatsflow.app">Contact support</a>
                </>
              )}
            </p>
          </div>
        </section>

        {/* HERO PANEL */}
        <section className="panel panel-hero">
          <div className="theme-toggle">
            <button
              type="button"
              className={`theme-btn ${theme === 'light' ? 'active' : ''}`}
              aria-label="Light mode"
              onClick={() => setThemeMode('light')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="4.5" stroke={theme === 'light' ? 'white' : 'currentColor'} strokeWidth="1.8" />
                <path d="M12 2.5V4.5M12 19.5V21.5M4.5 12H2.5M21.5 12H19.5M5.6 5.6L4.2 4.2M19.8 19.8L18.4 18.4M18.4 5.6L19.8 4.2M4.2 19.8L5.6 18.4" stroke={theme === 'light' ? 'white' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              className={`theme-btn ${theme === 'dark' ? 'active' : ''}`}
              aria-label="Dark mode"
              onClick={() => setThemeMode('dark')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M20 14.5C18.79 15.11 17.43 15.45 16 15.45C11.14 15.45 7.2 11.51 7.2 6.65C7.2 5.22 7.54 3.86 8.15 2.65C4.79 3.98 2.4 7.26 2.4 11.1C2.4 16.13 6.47 20.2 11.5 20.2C15.34 20.2 18.62 17.81 20 14.5Z" stroke={theme === 'dark' ? 'white' : 'currentColor'} strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <div className="hero-illustration">
            <svg className="deco-plane" width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden>
              <path d="M8 34L54 12L42 52L30 36L8 34Z" fill="#16A34A" />
              <path d="M30 36L54 12L20 44L30 36Z" fill="#15803D" />
            </svg>
            <div className="deco-ring" />

            <div className="phone-mock">
              <div className="phone-header">
                <span className="phone-avatar">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M12 2C6.48 2 2 6.48 2 12C2 13.85 2.5 15.58 3.38 17.07L2 22L7.05 20.65C8.5 21.5 10.19 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2Z" fill="white" />
                    <path d="M9.1 7.3C8.9 6.85 8.75 6.83 8.45 6.82C8.3 6.81 8.1 6.8 7.9 6.8C7.7 6.8 7.4 6.87 7.15 7.13C6.9 7.4 6.2 8.05 6.2 9.4C6.2 10.75 7.17 12.05 7.3 12.23C7.43 12.4 9.2 15.2 12 16.3C14.32 17.22 14.8 17.04 15.3 17C15.8 16.95 16.9 16.35 17.13 15.72C17.35 15.1 17.35 14.57 17.28 14.46C17.2 14.35 17 14.28 16.7 14.13C16.4 13.98 15 13.28 14.73 13.18C14.46 13.08 14.26 13.03 14.06 13.33C13.86 13.63 13.28 14.28 13.1 14.48C12.93 14.68 12.75 14.7 12.45 14.55C12.15 14.4 11.2 14.08 10.08 13.08C9.2 12.3 8.61 11.34 8.44 11.04C8.27 10.74 8.42 10.57 8.57 10.42C8.71 10.28 8.87 10.06 9.02 9.88C9.17 9.7 9.22 9.58 9.32 9.38C9.42 9.18 9.37 9 9.3 8.85C9.23 8.7 9.62 7.75 9.1 7.3Z" fill="#16A34A" />
                  </svg>
                </span>
                <span className="phone-bar phone-bar--header" />
                <svg className="phone-header-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M6.6 10.8C7.9 13.3 9.9 15.3 12.4 16.6L14.3 14.7C14.6 14.4 15 14.3 15.4 14.4C16.5 14.8 17.7 15 19 15C19.6 15 20 15.4 20 16V19.5C20 20.1 19.6 20.5 19 20.5C10.4 20.5 3.5 13.6 3.5 5C3.5 4.4 3.9 4 4.5 4H8C8.6 4 9 4.4 9 5C9 6.3 9.2 7.5 9.6 8.6C9.7 9 9.6 9.4 9.3 9.7L6.6 10.8Z" fill="white" />
                </svg>
                <svg className="phone-header-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="5" r="1.8" fill="white" />
                  <circle cx="12" cy="12" r="1.8" fill="white" />
                  <circle cx="12" cy="19" r="1.8" fill="white" />
                </svg>
              </div>
              <div className="phone-body">
                <span className="bubble bubble-in" />
                <span className="bubble bubble-in short" />
                <span className="bubble bubble-out">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <rect x="3" y="4" width="18" height="16" rx="2" stroke="#16A34A" strokeWidth="1.6" />
                    <circle cx="9" cy="10" r="1.8" stroke="#16A34A" strokeWidth="1.6" />
                    <path d="M4 17L9 12.5L12.5 15.5L16 11.5L20 15.5" stroke="#16A34A" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="bubble bubble-in" />
              </div>
            </div>

            <span className="floating-badge badge-1">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="9" cy="8" r="3" stroke="#16A34A" strokeWidth="1.8" />
                <path d="M3.5 19C3.5 15.96 6 13.5 9 13.5S14.5 15.96 14.5 19" stroke="#16A34A" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M15.5 6C16.88 6 18 7.12 18 8.5S16.88 11 15.5 11" stroke="#16A34A" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M15 13.6C17.42 13.99 19.5 15.9 19.5 19" stroke="#16A34A" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="floating-badge badge-2">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M4 5H20V16H8.5L4 19.5V5Z" stroke="#16A34A" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M8 9.5H16M8 12.5H13" stroke="#16A34A" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="floating-badge badge-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                <rect x="4" y="13" width="3.5" height="7" rx="1" fill="#16A34A" />
                <rect x="10.25" y="9" width="3.5" height="11" rx="1" fill="#16A34A" />
                <rect x="16.5" y="5" width="3.5" height="15" rx="1" fill="#16A34A" />
              </svg>
            </span>
          </div>

          <div className="hero-copy">
            <h2>
              {isSignup ? (
                <>Start free. <span>Grow faster.</span></>
              ) : (
                <>Your <span>WhatsApp</span>. Our Platform.</>
              )}
            </h2>
            <p>
              {isSignup
                ? 'Create your enterprise account, connect WhatsApp Business, and start messaging in minutes.'
                : 'Send bulk messages, manage your contacts, and grow your business — all from one place.'}
            </p>
          </div>

          <div className="feature-row">
            <div className="feature">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M13 2L4 14H11L10 22L20 9H13L13 2Z" stroke="#16A34A" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
              <span>Fast &amp; Reliable</span>
            </div>
            <div className="feature">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M12 2.5L20 5.5V11C20 16 16.5 19.9 12 21.5C7.5 19.9 4 16 4 11V5.5L12 2.5Z" stroke="#16A34A" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M8.5 12L11 14.5L15.5 9.5" stroke="#16A34A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Secure</span>
            </div>
            <div className="feature">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M12 20.5C12 20.5 3.5 15.4 3.5 9.6C3.5 6.8 5.7 4.5 8.5 4.5C10 4.5 11.3 5.2 12 6.3C12.7 5.2 14 4.5 15.5 4.5C18.3 4.5 20.5 6.8 20.5 9.6C20.5 15.4 12 20.5 12 20.5Z" stroke="#16A34A" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
              <span>Built for Businesses</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
