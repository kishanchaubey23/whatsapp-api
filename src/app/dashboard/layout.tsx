import type { Metadata } from 'next';
import './dashboard.css';

export const metadata: Metadata = {
  title: 'Dashboard · WhatsFlow',
  description: 'WhatsFlow enterprise dashboard — devices, contacts, bulk messaging, and analytics.',
  robots: { index: false, follow: false },
  alternates: { canonical: '/dashboard' },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
