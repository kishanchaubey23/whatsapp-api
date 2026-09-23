import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'FAQ',
    description: 'Frequently asked questions about Loopx (powered by Loopanda) — bulk email and WhatsApp messaging platform. Features, privacy, supported providers, WhatsApp safety, and more.',
    alternates: {
        canonical: '/faq',
    },
    openGraph: {
        title: 'FAQ — Loopx Bulk Messaging Platform',
        description: 'Answers to common questions about Loopx: features, privacy, supported providers, WhatsApp safety, and more.',
        url: 'https://loopx.loopanda.com/faq',
    },
};

export default function FaqLayout({ children }: { children: React.ReactNode }) {
    return children;
}
