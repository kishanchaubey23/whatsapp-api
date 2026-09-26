import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LanguageProvider } from "../i18n";
import { AuthProvider } from "../lib/auth-context";
import JsonLd from "../components/JsonLd";

const SITE_URL = "https://sender.qobouli.com";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export const metadata: Metadata = {
  title: {
    default: "Loopx — Bulk Email & WhatsApp Messaging Platform | powered by Loopanda",
    template: "%s | Loopx",
  },
  description:
    "Send personalized bulk emails and WhatsApp messages from CSV with Loopx (powered by Loopanda). Supports Gmail, iCloud+, custom SMTP, spin syntax, anti-ban delays. Free, fully offline & secure.",
  keywords: [
    "loopx", "loopanda", "bulk email", "bulk whatsapp", "csv email sender", "whatsapp bulk sender",
    "smtp sender", "email marketing tool", "whatsapp marketing",
    "mass email", "personalized messaging", "spin syntax", "anti-ban whatsapp",
    "إرسال بريد جماعي", "واتساب جماعي", "أداة إرسال رسائل",
    "toplu e-posta", "toplu whatsapp mesaj", "e-posta pazarlama",
  ],
  authors: [{ name: "Loopanda", url: "https://loopanda.com" }],
  creator: "Loopanda",
  publisher: "Loopanda",
  robots: { index: true, follow: true },
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: "/",
    languages: {
      "en": "/",
      "ar": "/",
      "tr": "/",
      "x-default": "/",
    },
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico" },
    ],
    shortcut: "/favicon.ico",
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Loopx powered by Loopanda",
    title: "Loopx — Bulk Email & WhatsApp Messaging",
    description: "Send personalized bulk emails and WhatsApp messages from CSV. Powered by Loopanda.",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: "Loopx — Bulk Email & WhatsApp Messaging",
    description: "Send personalized bulk emails and WhatsApp messages from CSV. Powered by Loopanda.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Comic+Relief:wght@400;700&display=swap"
          rel="stylesheet"
        />
        <JsonLd />
      </head>
      <body>
        <LanguageProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
