import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'About',
    description: 'Loopx is a bulk email and WhatsApp messaging platform powered by Loopanda. Learn about our features, security, and automation capabilities.',
    alternates: {
        canonical: '/about',
    },
    openGraph: {
        title: 'About Loopx — Bulk Messaging Platform powered by Loopanda',
        description: 'Bulk email and WhatsApp messaging platform. Powered by Loopanda.',
        url: 'https://loopx.loopanda.com/about',
    },
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
    return children;
}
