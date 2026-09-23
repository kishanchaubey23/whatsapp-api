<p align="center">
  <img src="public/logo-with-text.svg" alt="Loopx" width="220" />
</p>

<h1 align="center">Loopx</h1>

<p align="center">
  <strong>Bulk email & WhatsApp messaging platform powered by Loopanda</strong><br/>
  Upload a CSV, personalize with template variables, hit send. Secure, fast, and reliable.
</p>

<p align="center">
  <a href="https://loopx.loopanda.com">Live App</a> &bull;
  <a href="https://loopx.loopanda.com/about">About</a> &bull;
  <a href="https://loopx.loopanda.com/faq">FAQ</a> &bull;
  <a href="https://loopx.loopanda.com/privacy">Privacy</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
  <img src="https://img.shields.io/badge/platform-web%20%2B%20backend-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/languages-EN%20%7C%20AR%20%7C%20TR-orange" alt="Languages" />
</p>

---

## What is Loopx?

Loopx lets you send personalized bulk emails and WhatsApp messages to hundreds of contacts. Upload a CSV with your recipient data, write a message template with `{{variables}}`, configure your sending channel, and go.

**Two ways to send:**

| | Web App | Chrome Extension |
|---|---------|-----------------|
| **How** | Full dashboard at [loopx.loopanda.com](https://loopx.loopanda.com) | Sidebar inside Gmail & WhatsApp Web |
| **Email** | Any SMTP (Gmail, iCloud+, Outlook, custom) | Gmail compose automation |
| **WhatsApp** | QR / Pairing code via whatsapp-web.js | Direct WhatsApp Web messaging |
| **Backend** | Node.js + Express + BullMQ + Browserless | Zero backend (100% browser) |

## Features

- **CSV Upload** — Drag and drop. Columns auto-detected for email, phone, name
- **Template Variables** — `{{Name}}`, `{{Company}}`, or any CSV column header
- **Spin Syntax** — `{Hello|Hi|Hey}` gives each recipient a random variant
- **Anti-Ban Protection** — Configurable delays, jitter, batch cool-downs, daily limits
- **Live Progress** — Real-time sent/failed/skipped counters, cancel anytime
- **WhatsApp Media** — Send images, PDFs, documents (up to 16MB)
- **Browserless Integration** — Offload WhatsApp Web sessions to Browserless cloud Chromium
- **Message Delivery Tracking** — Pending, sent, delivered, read status for WhatsApp
- **100% Secure** — No analytics, no tracking. Data stays under your control
- **Multilingual** — English, Arabic (RTL), Turkish

## Quick Start

### 1. Frontend (Next.js)

```bash
# Install dependencies
npm install

# Run frontend dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) or [http://localhost:3001](http://localhost:3001).

### 2. Backend (Express + Prisma + BullMQ + Browserless)

```bash
cd backend
npm install

# Ensure PostgreSQL (port 5432) and Redis (port 6379) are running
npm run db:push

# Run full backend server & background worker
npm run dev:full
```

Backend API will start at [http://localhost:4000](http://localhost:4000).

## SMTP Provider Setup

Configuring a mailbox in the web app (iCloud, Gmail, **privateemail.com**, custom):
see [docs/smtp-providers.md](docs/smtp-providers.md).

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4 |
| Backend API | Node.js, Express 5, TypeScript, Prisma ORM, PostgreSQL |
| Worker Queue | BullMQ, Redis, ioredis |
| Cloud Browsers | Browserless.io |
| Email | Nodemailer 8 (SMTP) |
| WhatsApp | whatsapp-web.js 1.34 + Puppeteer |
| CSV | PapaParse 5 |
| Icons | Lucide React |

## Project Structure

```
src/
  app/
    api/          # Email & WhatsApp API routes
    dashboard/    # Main sending interface
    about/        # About page
    faq/          # FAQ page
    privacy/      # Privacy policy
  components/     # UI components
  i18n/           # EN, AR, TR translations
  lib/            # WhatsApp client & utilities
backend/          # Node.js Express API, BullMQ workers, Prisma ORM, Browserless factory
public/           # Logos, icons, robots.txt, llms.txt
```

## Privacy

- No third-party tracking or telemetry
- CSV data and SMTP credentials stay under your control
- Read our full [privacy policy](https://loopx.loopanda.com/privacy)

## License

MIT

---

<p align="center">
  Powered by <a href="https://loopanda.com"><strong>Loopanda</strong></a>
</p>
