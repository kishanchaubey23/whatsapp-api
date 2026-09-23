const SITE_URL = "https://loopx.loopanda.com";

const softwareApplication = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Loopx powered by Loopanda",
  "alternateName": ["Loopx", "لوبكس"],
  "applicationCategory": "BusinessApplication",
  "applicationSubCategory": "Email Marketing",
  "operatingSystem": "Web",
  "url": SITE_URL,
  "description": "Send personalized bulk emails and WhatsApp messages from CSV with Loopx (powered by Loopanda). Supports Gmail, iCloud+, custom SMTP, spin syntax, and anti-ban delays. Secure, fast, fully offline.",
  "inLanguage": ["en", "ar", "tr"],
  "offers": {
    "@type": "Offer",
    "name": "Free",
    "price": "0",
    "priceCurrency": "USD",
    "description": "Enterprise grade messaging platform"
  },
  "author": {
    "@type": "Organization",
    "name": "Loopanda",
    "url": "https://loopanda.com"
  },
  "featureList": [
    "Bulk email sending via SMTP (Gmail, iCloud+, custom domains)",
    "Bulk WhatsApp messaging via QR pairing",
    "CSV upload with auto-detected columns",
    "Template variables with personalization",
    "Spin syntax for message variation",
    "Anti-ban delays, jitter, batch cool-downs",
    "Real-time progress tracking and logs",
    "Multilingual: English, Arabic, Turkish"
  ]
};

const webSite = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Loopx",
  "alternateName": ["Loopx powered by Loopanda", "لوبكس"],
  "url": SITE_URL,
  "description": "Bulk email and WhatsApp messaging platform with CSV personalization",
  "inLanguage": ["en", "ar", "tr"],
  "publisher": {
    "@type": "Organization",
    "name": "Loopanda",
    "url": "https://loopanda.com"
  }
};

const faqPage = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Is Loopx free?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes, Loopx offers a complete bulk messaging solution powered by Loopanda."
      }
    },
    {
      "@type": "Question",
      "name": "Does Loopx store my data?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "No. All CSV data, SMTP credentials, and messages stay on your device."
      }
    },
    {
      "@type": "Question",
      "name": "What email providers does Loopx support?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Loopx works with any SMTP provider including Gmail, iCloud+, Outlook, Yahoo, and custom domains."
      }
    },
    {
      "@type": "Question",
      "name": "Can Loopx send WhatsApp messages?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. Loopx supports bulk WhatsApp messaging via QR code pairing with WhatsApp Web with full anti-ban protection."
      }
    }
  ]
};

const organization = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Loopanda",
  "url": "https://loopanda.com",
  "logo": `${SITE_URL}/logo-with-text.svg`,
  "description": "Software & communication development team at Loopanda."
};

export default function JsonLd() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplication) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webSite) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPage) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }}
      />
    </>
  );
}
