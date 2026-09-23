/**
 * WWBClientFactory — long-lived whatsapp-web.js clients on browserless.io
 * ----------------------------------------------------------------------
 * - Does NOT launch local Chromium in production (browserWSEndpoint).
 * - Clients keyed by WhatsAppAccount.id in an in-memory Map (worker process).
 * - Sticky residential proxy: --proxy-server + page.authenticate with
 *   password suffix `_session-${whatsappAccountId}` for 1:1 IP anchoring.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import wwebjs from 'whatsapp-web.js';
import type { Client as WWebClient, ClientOptions } from 'whatsapp-web.js';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';

// whatsapp-web.js CJS interop: named ESM import of LocalAuth fails on Node 24 / tsx
const { Client, LocalAuth } = wwebjs as unknown as {
  Client: typeof wwebjs.Client;
  LocalAuth: new (opts?: { dataPath?: string; clientId?: string }) => import('whatsapp-web.js').AuthStrategy;
};

export type ManagedClient = {
  accountId: string;
  sessionKey: string;
  client: WWebClient;
  status: 'initializing' | 'qr' | 'ready' | 'disconnected' | 'error';
  qr: string | null;
  lastError: string | null;
  createdAt: number;
};

export type ProxyConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
};

type AccountRow = {
  id: string;
  sessionKey: string;
  proxyHost: string | null;
  proxyPort: number | null;
  proxyUsername: string | null;
  proxyPassword: string | null;
};

function authRoot(): string {
  if (config.authDataPath) return config.authDataPath;
  return path.join(os.tmpdir(), '.wwebjs_auth_factory');
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Build browserless WebSocket URL with optional Chrome --proxy-server flag.
 * Sticky session is NOT put in the URL path — it is applied on proxy password.
 */
export function buildBrowserlessEndpoint(proxy?: ProxyConfig | null): string {
  const base = config.browserless.wsEndpoint?.trim();
  const token = config.browserless.token?.trim();

  if (!base) {
    if (config.browserless.allowLocalFallback) return '';
    throw new Error('BROWSERLESS_WS_ENDPOINT is required when local fallback is disabled');
  }

  const url = new URL(base);
  if (token && !url.searchParams.get('token')) {
    url.searchParams.set('token', token);
  }

  // browserless launch args — proxy host:port only (auth via page.authenticate)
  if (proxy?.host && proxy.port) {
    const proxyServer = `${proxy.host}:${proxy.port}`;
    // browserless.io accepts --proxy-server via launch query or args
    const existing = url.searchParams.get('--proxy-server') || url.searchParams.get('proxy');
    if (!existing) {
      url.searchParams.append('launch', JSON.stringify({
        args: [`--proxy-server=${proxyServer}`, '--no-sandbox', '--disable-setuid-sandbox'],
      }));
    }
  }

  return url.toString();
}

/**
 * Sticky residential password: basePassword_session-<accountId>
 * Provider-specific; common pattern for Bright Data / Oxylabs / IPRoyal session pinning.
 */
export function stickyProxyPassword(basePassword: string, whatsappAccountId: string): string {
  const clean = basePassword.replace(/_session-.*$/i, '');
  return `${clean}_session-${whatsappAccountId}`;
}

export function resolveProxyForAccount(account: AccountRow): ProxyConfig | null {
  const host = account.proxyHost || config.proxy.host;
  const port = account.proxyPort || config.proxy.port;
  const username = account.proxyUsername || config.proxy.username;
  const password = account.proxyPassword || config.proxy.password;

  if (!host || !port || !username || !password) return null;

  return {
    host,
    port: Number(port),
    username,
    password: stickyProxyPassword(password, account.id),
  };
}

export class WWBClientFactory {
  private static instance: WWBClientFactory | null = null;

  /** Long-lived clients — never create/destroy inside a single number loop */
  private readonly clients = new Map<string, ManagedClient>();
  private readonly initLocks = new Map<string, Promise<ManagedClient>>();

  static getInstance(): WWBClientFactory {
    if (!WWBClientFactory.instance) WWBClientFactory.instance = new WWBClientFactory();
    return WWBClientFactory.instance;
  }

  get(accountId: string): ManagedClient | undefined {
    return this.clients.get(accountId);
  }

  getReadyClient(accountId: string): WWebClient {
    const managed = this.clients.get(accountId);
    if (!managed || managed.status !== 'ready') {
      throw new Error(`WhatsApp client not ready for account ${accountId}`);
    }
    return managed.client;
  }

  listStatuses() {
    return [...this.clients.values()].map((c) => ({
      accountId: c.accountId,
      status: c.status,
      hasQr: Boolean(c.qr),
      lastError: c.lastError,
      uptimeMs: Date.now() - c.createdAt,
    }));
  }

  /**
   * Get or create a managed client for this DB account.
   * Safe to call from workers — concurrent callers share one init promise.
   */
  async getOrCreate(accountId: string): Promise<ManagedClient> {
    const existing = this.clients.get(accountId);
    if (existing && (existing.status === 'ready' || existing.status === 'qr' || existing.status === 'initializing')) {
      return existing;
    }

    const inflight = this.initLocks.get(accountId);
    if (inflight) return inflight;

    const boot = this.boot(accountId);
    this.initLocks.set(accountId, boot);
    try {
      return await boot;
    } finally {
      this.initLocks.delete(accountId);
    }
  }

  private async boot(accountId: string): Promise<ManagedClient> {
    const account = await prisma.whatsAppAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new Error(`WhatsAppAccount ${accountId} not found`);

    // Tear down stale instance if any
    await this.destroy(accountId, false);

    const proxy = resolveProxyForAccount(account);
    const dataPath = path.join(authRoot(), account.sessionKey);
    fs.mkdirSync(dataPath, { recursive: true });

    const browserWSEndpoint = buildBrowserlessEndpoint(proxy);

    const puppeteerOpts: ClientOptions['puppeteer'] = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        ...(proxy ? [`--proxy-server=${proxy.host}:${proxy.port}`] : []),
      ],
    };

    if (browserWSEndpoint) {
      // Offload Chromium to browserless — no local Chrome process
      (puppeteerOpts as { browserWSEndpoint?: string }).browserWSEndpoint = browserWSEndpoint;
    } else if (!config.browserless.allowLocalFallback) {
      throw new Error('No browserless endpoint configured');
    }

    const client = new Client({
      authStrategy: new LocalAuth({
        dataPath: authRoot(),
        clientId: account.sessionKey,
      }) as import('whatsapp-web.js').AuthStrategy,
      puppeteer: puppeteerOpts,
    });

    const managed: ManagedClient = {
      accountId,
      sessionKey: account.sessionKey,
      client,
      status: 'initializing',
      qr: null,
      lastError: null,
      createdAt: Date.now(),
    };
    this.clients.set(accountId, managed);

    // Sticky proxy auth on every new page (browserless + local)
    client.on('puppeteer_page' as 'change_state', async (...args: unknown[]) => {
      const page = args[0] as {
        authenticate?: (creds: { username: string; password: string }) => Promise<void>;
      };
      if (proxy && page?.authenticate) {
        try {
          await page.authenticate({
            username: proxy.username,
            password: proxy.password,
          });
        } catch (err) {
          console.warn('[WWBClientFactory] page.authenticate failed', accountId, err);
        }
      }
    });

    // whatsapp-web.js emits puppeteer_page — cast via on any
    (client as unknown as { on: (e: string, fn: (...a: unknown[]) => void) => void }).on(
      'puppeteer_page',
      async (page: unknown) => {
        if (!proxy) return;
        const p = page as { authenticate: (c: { username: string; password: string }) => Promise<void> };
        try {
          await p.authenticate({ username: proxy.username, password: proxy.password });
        } catch (err) {
          console.warn('[WWBClientFactory] proxy auth error', err);
        }
      },
    );

    client.on('qr', async (qr) => {
      managed.status = 'qr';
      managed.qr = qr;
      await prisma.whatsAppAccount.update({
        where: { id: accountId },
        data: { status: 'pending_qr' },
      });
    });

    client.on('ready', async () => {
      managed.status = 'ready';
      managed.qr = null;
      const phone = client.info?.wid?.user ?? null;
      const businessName = client.info?.pushname ?? null;
      await prisma.whatsAppAccount.update({
        where: { id: accountId },
        data: {
          status: 'ready',
          phone,
          businessName,
          lastReadyAt: new Date(),
          lastError: null,
        },
      });
      const masked =
        phone && phone.length >= 6 ? `${phone.slice(0, 3)}***${phone.slice(-3)}` : phone ? '***' : null;
      console.log(`[WWBClientFactory] ready account=${accountId} phone=${masked}`);
    });

    // Keyword auto-reply on inbound private messages
    client.on('message', async (msg) => {
      try {
        await this.handleInboundAutoReply(accountId, client, msg);
      } catch (err) {
        console.warn(
          '[WWBClientFactory] auto-reply error',
          accountId,
          err instanceof Error ? err.message : err,
        );
      }
    });

    client.on('authenticated', () => {
      managed.qr = null;
    });

    client.on('auth_failure', async (msg) => {
      managed.status = 'error';
      managed.lastError = msg;
      await prisma.whatsAppAccount.update({
        where: { id: accountId },
        data: { status: 'error', lastError: msg },
      });
    });

    client.on('disconnected', async (reason) => {
      managed.status = 'disconnected';
      managed.lastError = String(reason);
      this.clients.delete(accountId);
      await prisma.whatsAppAccount.update({
        where: { id: accountId },
        data: { status: 'disconnected', lastError: String(reason) },
      });
      console.warn(`[WWBClientFactory] disconnected account=${accountId}`, reason);
    });

    try {
      await prisma.whatsAppAccount.update({
        where: { id: accountId },
        data: { status: 'connecting', lastError: null },
      });
      await client.initialize();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      managed.status = 'error';
      managed.lastError = message;
      this.clients.delete(accountId);
      await prisma.whatsAppAccount.update({
        where: { id: accountId },
        data: { status: 'error', lastError: message },
      });
      try {
        await client.destroy();
      } catch {
        /* ignore */
      }
      throw err;
    }

    return managed;
  }

  /**
   * Match inbound private text against auto-reply rules and send response.
   */
  private async handleInboundAutoReply(
    accountId: string,
    client: WWebClient,
    msg: {
      fromMe?: boolean;
      body?: string;
      from?: string;
      to?: string;
      hasMedia?: boolean;
      getChat?: () => Promise<{ isGroup?: boolean; id?: { _serialized?: string } }>;
      reply?: (content: string) => Promise<unknown>;
    },
  ): Promise<void> {
    if (msg.fromMe) return;
    const body = typeof msg.body === 'string' ? msg.body : '';
    if (!body.trim()) return;

    let isGroup = false;
    try {
      const chat = msg.getChat ? await msg.getChat() : null;
      isGroup = Boolean(chat?.isGroup);
    } catch {
      isGroup = String(msg.from || '').includes('@g.us');
    }
    if (isGroup) return;

    const fromRaw = String(msg.from || '');
    const fromPhone = fromRaw.replace(/@c\.us$/i, '').replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '');
    if (!fromPhone) return;

    const { findMatchingAutoReply, recordAutoReplySent } = await import('./AutoReplyService.js');
    const match = await findMatchingAutoReply({
      accountId,
      fromPhone,
      body,
      isGroup: false,
      fromMe: false,
    });
    if (!match) return;

    const account = await prisma.whatsAppAccount.findUnique({
      where: { id: accountId },
      select: { userId: true, status: true },
    });
    if (!account || account.status !== 'ready') return;

    try {
      if (typeof msg.reply === 'function') {
        await msg.reply(match.rule.responseBody);
      } else {
        const chatId = fromRaw.includes('@') ? fromRaw : `${fromPhone}@c.us`;
        await client.sendMessage(chatId, match.rule.responseBody);
      }
      await recordAutoReplySent({
        userId: account.userId,
        ruleId: match.rule.id,
        whatsappAccountId: accountId,
        fromPhone,
        matchedKeyword: match.matchedKeyword,
        incomingPreview: body,
      });
    } catch (err) {
      console.warn(
        '[WWBClientFactory] auto-reply send failed',
        accountId,
        err instanceof Error ? err.message : err,
      );
    }
  }

  /**
   * Wait until client is ready (e.g. after QR) or timeout.
   */
  async waitUntilReady(accountId: string, timeoutMs = 120_000): Promise<WWebClient> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const m = this.clients.get(accountId);
      if (m?.status === 'ready') return m.client;
      if (m?.status === 'error') throw new Error(m.lastError || 'Client error');
      await sleep(1000);
    }
    throw new Error(`Timeout waiting for WhatsApp ready (${accountId})`);
  }

  async destroy(accountId: string, updateDb = true): Promise<void> {
    const managed = this.clients.get(accountId);
    if (!managed) return;
    this.clients.delete(accountId);
    try {
      await managed.client.destroy();
    } catch (err) {
      console.warn('[WWBClientFactory] destroy error', accountId, err);
    }
    if (updateDb) {
      await prisma.whatsAppAccount.update({
        where: { id: accountId },
        data: { status: 'disconnected' },
      }).catch(() => undefined);
    }
  }

  async destroyAll(): Promise<void> {
    const ids = [...this.clients.keys()];
    await Promise.all(ids.map((id) => this.destroy(id, false)));
  }
}

export const wwbClientFactory = WWBClientFactory.getInstance();
