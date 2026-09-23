import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Privacy Policy',
    description: 'Privacy policy for Loopx (powered by Loopanda) bulk messaging platform. Learn how your data is handled — secure, no tracking, fully offline.',
    alternates: {
        canonical: '/privacy',
    },
    openGraph: {
        title: 'Privacy Policy — Loopx',
        description: 'Privacy policy for Loopx. No tracking, no analytics, fully offline. Your data stays on your device.',
        url: 'https://loopx.loopanda.com/privacy',
    },
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
    return children;
}
