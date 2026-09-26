import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { Client, LocalAuth, MessageMedia, type Message } from 'whatsapp-web.js';

export type WAStatus =
  | 'disconnected'
  | 'reconnecting'
  | 'qr'
  | 'verifying'
  | 'ready'
  | 'rejected';

/** ACK level from whatsapp-web.js message_ack event */
export type AckStatus = 0 | 1 | 2 | 3;

/** Profile health after Business verification */
export type WAProfileReport = {
  isBusiness: boolean;
  isEnterprise: boolean;
  allowed: boolean;
  rejectionReason: string | null;
  phone?: string;
  pushname?: string;
  businessName?: string | null;
  verifiedName?: string | null;
  about?: string | null;
  hasProfilePic: boolean;
  profilePicUrl?: string | null;
  completeness: {
    score: number;
    max: number;
    missing: string[];
    checks: {
      businessAccount: boolean;
      profilePicture: boolean;
      about: boolean;
      displayName: boolean;
      businessName: boolean;
    };
  };
  verifiedAt: string;
};

interface WAClientState {
  client: Client | null;
  status: WAStatus;
  qrString: string | null;
  pairingCode: string | null;
  info: { pushname?: string; wid?: string } | null;
  /** messageId → latest ACK level */
  ackMap: Map<string, AckStatus>;
  /** Last initialization error message, if any */
  lastError: string | null;
  profile: WAProfileReport | null;
  /** Active LocalAuth clientId / device session id */
  sessionId: string | null;
}

// Use globalThis to survive Next.js hot-reloads in development
declare global {
  var __waClientState: WAClientState | undefined;
}

function getState(): WAClientState {
  if (!globalThis.__waClientState) {
    globalThis.__waClientState = {
      client: null,
      status: 'disconnected',
      qrString: null,
      pairingCode: null,
      info: null,
      ackMap: new Map(),
      lastError: null,
      profile: null,
      sessionId: null,
    };
  }
  return globalThis.__waClientState;
}

export function getStatus(): WAStatus {
  return getState().status;
}

export function getQR(): string | null {
  return getState().qrString;
}

export function getPairingCode(): string | null {
  return getState().pairingCode;
}

export function getClientInfo(): { pushname?: string; wid?: string } | null {
  return getState().info;
}

export function getProfileReport(): WAProfileReport | null {
  return getState().profile;
}

export function getActiveSessionId(): string | null {
  return getState().sessionId;
}

/** Returns the last initialization error message, or null if there was no error. */
export function getError(): string | null {
  return getState().lastError;
}

/** Returns the latest ACK level for a given message ID, or null if not tracked. */
export function getAckStatus(messageId: string): AckStatus | null {
  return getState().ackMap.get(messageId) ?? null;
}

/**
 * Returns the full ACK map snapshot as a plain object.
 * Used by the /api/whatsapp/ack route.
 */
export function getAllAcks(): Record<string, AckStatus> {
  return Object.fromEntries(getState().ackMap.entries());
}

// Use os.tmpdir() so this path is always writable — both in local dev and in
// serverless/Lambda environments where the project root (/var/task) is read-only.
const AUTH_PATH = path.join(os.tmpdir(), '.wwebjs_auth');

function sessionDirFor(sessionId?: string | null): string {
  // LocalAuth stores as session or session-{clientId}
  if (sessionId) return path.join(AUTH_PATH, `session-${sessionId}`);
  return path.join(AUTH_PATH, 'session');
}

/** Check whether a persisted LocalAuth session exists on disk. */
export function isSessionSaved(sessionId?: string | null): boolean {
  try {
    const id = sessionId ?? getState().sessionId;
    return fs.existsSync(sessionDirFor(id));
  } catch {
    return false;
  }
}

/**
 * Remove the persisted LocalAuth session from disk so the next
 * `initialize()` call will start a fresh QR-code flow.
 */
export function clearSavedSession(sessionId?: string | null): void {
  try {
    const dir = sessionDirFor(sessionId ?? getState().sessionId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('[WhatsApp] Failed to clear saved session:', err);
  }
}

/**
 * Clear all auth data, local cache (.wwebjs_auth, .wwebjs_cache), and reset state.
 */
export function clearAllCaches(): void {
  try {
    if (fs.existsSync(AUTH_PATH)) {
      fs.rmSync(AUTH_PATH, { recursive: true, force: true });
    }
    const rootCache = path.join(process.cwd(), '.wwebjs_cache');
    if (fs.existsSync(rootCache)) {
      fs.rmSync(rootCache, { recursive: true, force: true });
    }
    const tmpCache = path.join(os.tmpdir(), '.wwebjs_cache');
    if (fs.existsSync(tmpCache)) {
      fs.rmSync(tmpCache, { recursive: true, force: true });
    }
    const state = getState();
    state.client = null;
    state.status = 'disconnected';
    state.qrString = null;
    state.pairingCode = null;
    state.info = null;
    state.lastError = null;
    state.profile = null;
    state.sessionId = null;
    state.ackMap.clear();
    console.log('[WhatsApp] All auth caches and sessions cleared.');
  } catch (err) {
    console.error('[WhatsApp] Failed to clear all caches:', err);
  }
}

/**
 * Request a phone number pairing code from whatsapp-web.js.
 */
export async function requestPairingCode(phoneNumber: string, sessionId?: string): Promise<string> {
  const cleanPhone = phoneNumber.replace(/\D/g, '');
  if (!cleanPhone || cleanPhone.length < 7) {
    throw new Error(`Invalid phone number for pairing: "${phoneNumber}"`);
  }

  const state = getState();
  const targetSession = sessionId || state.sessionId || `session_${Date.now()}`;

  if (!state.client || state.status === 'disconnected') {
    await initialize({ sessionId: targetSession });
  }

  let attempts = 0;
  while (!state.client && attempts < 10) {
    await new Promise((r) => setTimeout(r, 500));
    attempts++;
  }

  if (!state.client) {
    throw new Error('WhatsApp client failed to initialize for pairing code');
  }

  try {
    const code = await state.client.requestPairingCode(cleanPhone);
    state.pairingCode = code;
    state.status = 'qr';
    return code;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    state.lastError = `Pairing code error: ${msg}`;
    throw err;
  }
}

/**
 * Remove stale Puppeteer singleton lock/socket files left behind by a
 * previous browser instance that was killed without a clean shutdown.
 * Without this cleanup, Puppeteer refuses to launch with
 * "The browser is already running for <path>".
 */
function clearPuppeteerLocks(userDataDir: string): void {
  const lockFiles = [
    'SingletonLock',
    'SingletonSocket',
    'SingletonCookie',
    'lockfile',
    'DevToolsActivePort',
  ];
  for (const name of lockFiles) {
    const filePath = path.join(userDataDir, name);
    try {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
        console.log(`[WhatsApp] Removed stale lock file: ${filePath}`);
      }
    } catch (err) {
      console.warn(`[WhatsApp] Could not remove lock file ${filePath}:`, err);
    }
  }
}

/**
 * Kill Chromium/Chrome processes still holding the WA session profile.
 * Required on Windows after destroy()/hot-reload leaves a zombie browser.
 */
function killOrphanBrowsers(): void {
  try {
    if (process.platform === 'win32') {
      const script = `
$names = @('chrome.exe','chromium.exe','msedge.exe')
Get-CimInstance Win32_Process | Where-Object {
  $names -contains $_.Name -and $_.CommandLine -and (
    $_.CommandLine -match '\\.wwebjs_auth' -or $_.CommandLine -match 'wwebjs_auth'
  )
} | ForEach-Object {
  try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {}
}
`;
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      execSync(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, {
        stdio: 'ignore',
        timeout: 20000,
        windowsHide: true,
      });
    } else {
      execSync('pkill -f ".wwebjs_auth" 2>/dev/null || true', {
        stdio: 'ignore',
        timeout: 10000,
        shell: '/bin/bash',
      });
    }
    console.log('[WhatsApp] Cleared orphan browser processes for session dir');
  } catch (err) {
    console.warn('[WhatsApp] Orphan browser cleanup skipped/failed:', err);
  }
}

/** Full prep before launching Puppeteer: kill zombies + drop lock files. */
function prepareBrowserLaunch(sessionId?: string | null): void {
  killOrphanBrowsers();
  clearPuppeteerLocks(sessionDirFor(sessionId));
  // Also clear locks under AUTH_PATH root if present
  clearPuppeteerLocks(AUTH_PATH);
}

/**
 * Auto-initialise the client when a saved session exists and the client
 * is currently disconnected.  This is called by the status endpoint so
 * that a page reload after a server restart reconnects automatically.
 */
export function autoInit(): void {
  const state = getState();
  if (state.status === 'disconnected' && isSessionSaved()) {
    state.status = 'reconnecting';
    state.lastError = null;
    initialize().catch((err: Error) => {
      console.error('[WhatsApp] Auto-reconnect failed:', err);
      state.status = 'disconnected';
      state.lastError = err.message;
    });
  }
}

export async function initialize(options?: { sessionId?: string }): Promise<void> {
  const state = getState();
  const sessionId = options?.sessionId || state.sessionId || `session_${Date.now()}`;

  if (
    state.client &&
    state.sessionId === sessionId &&
    state.status !== 'disconnected' &&
    state.status !== 'reconnecting' &&
    state.status !== 'rejected'
  ) {
    // Already initialized for this session
    return;
  }

  // Clear any previous error
  state.lastError = null;
  state.sessionId = sessionId;
  state.profile = null;
  state.qrString = null;

  // If a saved session exists, show 'reconnecting' so the UI can give appropriate feedback
  if (state.status === 'disconnected' && isSessionSaved(sessionId)) {
    state.status = 'reconnecting';
  }

  // Ensure the auth directory exists before LocalAuth tries to create sub-directories.
  // This is essential in serverless environments (e.g. Vercel/Lambda) where only
  // os.tmpdir() (/tmp) is writable — the directory may not exist yet on a cold start.
  try {
    fs.mkdirSync(AUTH_PATH, { recursive: true });
  } catch (err) {
    console.warn('[WhatsApp] Could not pre-create auth directory:', err);
  }

  // If a previous client object exists (failed init / hot reload), tear it down first
  if (state.client) {
    try {
      await state.client.destroy();
    } catch {
      /* ignore */
    }
    state.client = null;
  }

  // Kill zombie Chromium + remove SingletonLock so Puppeteer can launch again
  prepareBrowserLaunch(sessionId);

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_PATH, clientId: sessionId }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
      ],
    },
  });

  state.client = client;
  state.qrString = null;
  state.info = null;

  client.on('qr', (qr: string) => {
    state.qrString = qr;
    state.status = 'qr';
    console.log('[WhatsApp] QR code received');
  });

  client.on('authenticated', () => {
    state.qrString = null;
    console.log('[WhatsApp] Authenticated');
  });

  client.on('ready', () => {
    state.status = 'verifying';
    state.qrString = null;
    const info = client.info;
    if (info) {
      state.info = {
        pushname: info.pushname,
        wid: info.wid?.user,
      };
    }
    console.log('[WhatsApp] Client ready — verifying Business account + profile…');
    void verifyBusinessProfile(client).then(async (report) => {
      state.profile = report;
      if (!report.allowed) {
        state.status = 'rejected';
        state.lastError = report.rejectionReason;
        console.warn('[WhatsApp] Rejected non-business / incomplete account:', report.rejectionReason);
        try {
          await client.logout();
        } catch {
          /* ignore */
        }
        try {
          await client.destroy();
        } catch {
          /* ignore */
        }
        state.client = null;
        prepareBrowserLaunch(sessionId);
        clearSavedSession(sessionId);
        return;
      }
      state.status = 'ready';
      state.lastError = null;
      console.log('[WhatsApp] Business account verified. Completeness', report.completeness.score);
    });
  });

  client.on('auth_failure', (msg: string) => {
    console.error('[WhatsApp] Auth failure:', msg);
    // Always reset state first so the client is usable again regardless of session-clear outcome
    state.status = 'disconnected';
    state.lastError = msg;
    state.qrString = null;
    state.client = null;
    // Clear saved session so next connect starts a fresh QR flow
    clearSavedSession(sessionId);
  });

  client.on('disconnected', (reason: string) => {
    state.status = 'disconnected';
    state.qrString = null;
    state.client = null;
    state.info = null;
    console.log('[WhatsApp] Disconnected:', reason);
  });

  client.on('message_ack', (msg: Message, ack: number) => {
    state.ackMap.set(msg.id.id, ack as AckStatus);
    console.log(`[WhatsApp] Message ACK — id=${msg.id.id} ack=${ack}`);
  });

  try {
    await client.initialize();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[WhatsApp] client.initialize() failed:', message);

    // Common after crash/hot-reload: retry once after forcing browser cleanup
    if (/already running|userDataDir|SingletonLock/i.test(message)) {
      console.warn('[WhatsApp] Browser lock conflict — force cleanup and retry once');
      try {
        await client.destroy();
      } catch {
        /* ignore */
      }
      state.client = null;
      prepareBrowserLaunch(sessionId);
      await new Promise((r) => setTimeout(r, 1500));

      const retry = new Client({
        authStrategy: new LocalAuth({ dataPath: AUTH_PATH, clientId: sessionId }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
          ],
        },
      });
      // Re-bind the same handlers used above
      retry.on('qr', (qr: string) => {
        state.qrString = qr;
        state.status = 'qr';
      });
      retry.on('authenticated', () => {
        state.qrString = null;
      });
      retry.on('ready', () => {
        state.status = 'verifying';
        state.qrString = null;
        const info = retry.info;
        if (info) {
          state.info = { pushname: info.pushname, wid: info.wid?.user };
        }
        void verifyBusinessProfile(retry).then(async (report) => {
          state.profile = report;
          if (!report.allowed) {
            state.status = 'rejected';
            state.lastError = report.rejectionReason;
            try {
              await retry.destroy();
            } catch {
              /* ignore */
            }
            state.client = null;
            prepareBrowserLaunch(sessionId);
            clearSavedSession(sessionId);
            return;
          }
          state.status = 'ready';
        });
      });
      retry.on('auth_failure', (msg: string) => {
        state.status = 'disconnected';
        state.lastError = msg;
        state.qrString = null;
        state.client = null;
        clearSavedSession(sessionId);
      });
      retry.on('disconnected', () => {
        state.status = 'disconnected';
        state.qrString = null;
        state.client = null;
        state.info = null;
      });
      retry.on('message_ack', (msg: Message, ack: number) => {
        state.ackMap.set(msg.id.id, ack as AckStatus);
      });

      try {
        state.client = retry;
        await retry.initialize();
        return;
      } catch (retryErr: unknown) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        state.status = 'disconnected';
        state.lastError = retryMsg;
        state.client = null;
        prepareBrowserLaunch(sessionId);
        throw retryErr;
      }
    }

    state.status = 'disconnected';
    state.lastError = message;
    state.client = null;
    prepareBrowserLaunch(sessionId);
    throw err;
  }
}

/** Validate and normalize a phone number. Returns normalized digits or throws. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[\s\-\(\)\+]/g, '');
  if (!/^\d{7,15}$/.test(digits)) {
    throw new Error(`Invalid phone number format: "${phone}". Expected 7–15 digits.`);
  }
  return digits;
}

/**
 * Send a text message to a phone number (E.164 format without '+').
 * Retries up to 3 times with exponential backoff (5s → 10s → 20s) on transient errors.
 */
export async function sendMessage(phone: string, text: string): Promise<string> {
  const state = getState();

  if (!state.client || state.status !== 'ready') {
    throw new Error('WhatsApp client is not ready');
  }

  const chatId = `${phone}@c.us`;

  let lastError: Error | null = null;
  const backoffMs = [5000, 10000, 20000];

  for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
    try {
      const result = await state.client.sendMessage(chatId, text);
      return result.id.id;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const errorMsg = lastError.message.toLowerCase();

      // Don't retry on permanent errors (number not found, etc.)
      if (errorMsg.includes('not registered') || errorMsg.includes('invalid wid')) {
        throw lastError;
      }

      // Check if client disconnected mid-send
      if (state.status !== 'ready') {
        throw new Error('WhatsApp client disconnected during send');
      }

      if (attempt < backoffMs.length) {
        const delay = backoffMs[attempt];
        console.warn(`[WhatsApp] Send failed (attempt ${attempt + 1}), retrying in ${delay / 1000}s…`, lastError.message);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new Error('Failed to send message after retries');
}

/**
 * Send a media message (image / document) with an optional caption.
 *
 * @param phone      - Phone number digits (no '+' or spaces)
 * @param mediaBase64 - Base64-encoded file content
 * @param mimeType   - MIME type, e.g. 'image/png', 'application/pdf'
 * @param filename   - Original filename shown in WhatsApp
 * @param caption    - Optional text caption
 */
export async function sendMedia(
  phone: string,
  mediaBase64: string,
  mimeType: string,
  filename: string,
  caption?: string,
): Promise<string> {
  const state = getState();

  if (!state.client || state.status !== 'ready') {
    throw new Error('WhatsApp client is not ready');
  }

  const chatId = `${phone}@c.us`;
  const media = new MessageMedia(mimeType, mediaBase64, filename);

  const result = await state.client.sendMessage(chatId, media, { caption });
  return result.id.id;
}

export async function isRegisteredUser(phone: string): Promise<boolean> {
  const state = getState();

  if (!state.client || state.status !== 'ready') {
    throw new Error('WhatsApp client is not ready');
  }

  const chatId = `${phone}@c.us`;
  return state.client.isRegisteredUser(chatId);
}

/**
 * Inspect the linked account: must be WhatsApp Business (or Enterprise).
 * Collects profile picture, about, business/display name for completeness.
 * Personal (normal) accounts are rejected — session is not kept.
 */
export async function verifyBusinessProfile(client: Client): Promise<WAProfileReport> {
  const wid = client.info?.wid?._serialized || (client.info?.wid?.user ? `${client.info.wid.user}@c.us` : null);
  const pushname = client.info?.pushname || undefined;
  const phone = client.info?.wid?.user;

  let isBusiness = false;
  let isEnterprise = false;
  let about: string | null = null;
  let profilePicUrl: string | null = null;
  let businessName: string | null = null;
  let verifiedName: string | null = null;

  try {
    if (wid) {
      const contact = await client.getContactById(wid);
      isBusiness = Boolean(contact.isBusiness || contact.isEnterprise);
      isEnterprise = Boolean(contact.isEnterprise);
      verifiedName = (contact as { verifiedName?: string }).verifiedName ?? null;
      businessName = verifiedName || contact.name || null;

      try {
        about = await contact.getAbout();
      } catch {
        about = null;
      }
      try {
        profilePicUrl = (await contact.getProfilePicUrl()) || null;
      } catch {
        profilePicUrl = null;
      }

      // BusinessContact may expose businessProfile
      const bp = (contact as { businessProfile?: { description?: string; email?: string } }).businessProfile;
      if (bp?.description && !about) about = bp.description;
    }
  } catch (err) {
    console.warn('[WhatsApp] Profile fetch partial failure:', err);
  }

  // Fallback: some builds expose isBusiness only via store after delay
  if (!isBusiness && wid) {
    try {
      const contact2 = await client.getContactById(wid);
      isBusiness = Boolean(contact2.isBusiness || contact2.isEnterprise);
    } catch {
      /* ignore */
    }
  }

  const hasProfilePic = Boolean(profilePicUrl);
  const hasAbout = Boolean(about && about.trim().length > 0);
  const hasDisplayName = Boolean(pushname && pushname.trim().length > 0);
  const hasBusinessName = Boolean(businessName && businessName.trim().length > 0);

  const checks = {
    businessAccount: isBusiness || isEnterprise,
    profilePicture: hasProfilePic,
    about: hasAbout,
    displayName: hasDisplayName,
    businessName: hasBusinessName,
  };

  const missing: string[] = [];
  if (!checks.businessAccount) missing.push('WhatsApp Business account (personal WhatsApp not allowed)');
  if (!checks.profilePicture) missing.push('Profile picture');
  if (!checks.about) missing.push('About / business description');
  if (!checks.displayName) missing.push('Display name (push name)');
  if (!checks.businessName) missing.push('Business name');

  // Completeness: business required; other fields are health score (4 optional + 1 required)
  const optionalDone = [hasProfilePic, hasAbout, hasDisplayName, hasBusinessName].filter(Boolean).length;
  const score = (checks.businessAccount ? 1 : 0) + optionalDone;
  const max = 5;

  let allowed = checks.businessAccount;
  let rejectionReason: string | null = null;
  if (!allowed) {
    rejectionReason =
      'This number is a normal (personal) WhatsApp account. WhatsFlow only accepts WhatsApp Business accounts. Please upgrade to WhatsApp Business and try again.';
  }

  return {
    isBusiness: isBusiness || isEnterprise,
    isEnterprise,
    allowed,
    rejectionReason,
    phone,
    pushname,
    businessName,
    verifiedName,
    about,
    hasProfilePic,
    profilePicUrl,
    completeness: { score, max, missing, checks },
    verifiedAt: new Date().toISOString(),
  };
}

export async function disconnect(options?: { clearSession?: boolean; sessionId?: string }): Promise<void> {
  const state = getState();
  const clearSession = options?.clearSession !== false; // default: full logout
  const sessionId = options?.sessionId ?? state.sessionId;

  try {
    if (state.client) {
      try {
        // Prefer logout when session should be wiped (forces re-QR next time)
        if (clearSession && (state.status === 'ready' || state.status === 'verifying')) {
          try {
            await state.client.logout();
          } catch {
            /* destroy still runs below */
          }
        }
        await state.client.destroy();
      } catch (err) {
        console.warn('[WhatsApp] destroy() error (continuing cleanup):', err);
      }
    }
  } finally {
    state.client = null;
    state.status = 'disconnected';
    state.qrString = null;
    state.info = null;
    state.lastError = null;
    state.profile = null;
    state.ackMap.clear();

    // Always free the profile so the next Connect works
    prepareBrowserLaunch(sessionId);

    if (clearSession) {
      clearSavedSession(sessionId);
      // Locks may reappear under a half-deleted tree; clear again
      prepareBrowserLaunch(sessionId);
    }
  }
}
