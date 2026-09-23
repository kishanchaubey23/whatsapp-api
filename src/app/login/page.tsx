import { Suspense } from 'react';
import AuthForm from '@/components/AuthForm';
import './styles.css';

export const metadata = {
  title: 'Sign in · WhatsFlow',
  description: 'Sign in or create your WhatsFlow account',
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="wf-login-root" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
          Loading…
        </div>
      }
    >
      <AuthForm initialMode="login" />
    </Suspense>
  );
}
