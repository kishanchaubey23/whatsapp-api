import { Suspense } from 'react';
import AuthForm from '@/components/AuthForm';
import '../login/styles.css';

export const metadata = {
  title: 'Create account · WhatsFlow',
  description: 'Create your WhatsFlow enterprise account',
};

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="wf-login-root" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
          Loading…
        </div>
      }
    >
      <AuthForm initialMode="signup" />
    </Suspense>
  );
}
