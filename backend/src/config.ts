try {
  process.loadEnvFile();
} catch {
  // Ignore if .env is missing or already loaded
}

function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing env: ${key}`);
  return v;
}

function parseRedisUrl(url: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: Record<string, never>;
  maxRetriesPerRequest: null;
} {
  try {
    const u = new URL(url);

    return {
      host: u.hostname || '127.0.0.1',
      port: Number(u.port || 6379),
      username: u.username
        ? decodeURIComponent(u.username)
        : undefined,
      password: u.password
        ? decodeURIComponent(u.password)
        : undefined,

      // Upstash uses rediss:// (TLS)
      ...(u.protocol === 'rediss:' ? { tls: {} } : {}),

      // Required by BullMQ workers
      maxRetriesPerRequest: null,
    };
  } catch {
    return {
      host: '127.0.0.1',
      port: 6379,
      maxRetriesPerRequest: null,
    };
  }
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  jwtSecret: env('JWT_SECRET', 'dev-enterprise-jwt'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()),
  databaseUrl: env('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/sendstack'),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  get redisConnection() {
    return parseRedisUrl(this.redisUrl);
  },
  queueName: process.env.QUEUE_NAME ?? 'wa-blast-jobs',
  /** BullMQ concurrency: keep low — each job holds a long-lived browser session */
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
  /** Anti-ban sleep between numbers (ms) */
  antiBanSleepMinMs: Number(process.env.ANTI_BAN_SLEEP_MIN_MS ?? 20_000),
  antiBanSleepMaxMs: Number(process.env.ANTI_BAN_SLEEP_MAX_MS ?? 45_000),
  /** Max phones per API batch */
  maxBatchSize: Number(process.env.MAX_BLAST_BATCH_SIZE ?? 5000),
  /** Chunk size when splitting large uploads into queue jobs */
  queueChunkSize: Number(process.env.QUEUE_CHUNK_SIZE ?? 100),
  browserless: {
    /** wss://chrome.browserless.io?token=...  OR self-hosted ws://localhost:3000 */
    wsEndpoint: process.env.BROWSERLESS_WS_ENDPOINT ?? '',
    token: process.env.BROWSERLESS_TOKEN ?? '',
    /** If empty WS endpoint, factory may fall back to local puppeteer (dev only) */
    allowLocalFallback: (process.env.BROWSERLESS_ALLOW_LOCAL ?? 'true') === 'true',
  },
  /** Default residential proxy template (per-account overrides in DB) */
  proxy: {
    host: process.env.PROXY_HOST ?? '',
    port: process.env.PROXY_PORT ? Number(process.env.PROXY_PORT) : undefined,
    username: process.env.PROXY_USERNAME ?? '',
    password: process.env.PROXY_PASSWORD ?? '',
  },
  authDataPath: process.env.WA_AUTH_DATA_PATH ?? '',
  /** Global WhatsApp registration cache TTLs (days) */
  globalWa: {
    positiveTtlDays: Number(process.env.GLOBAL_WA_POSITIVE_TTL_DAYS ?? 30),
    negativeTtlDays: Number(process.env.GLOBAL_WA_NEGATIVE_TTL_DAYS ?? 7),
  },
  /** Phase 3: dedicated registry recheck lane (isolated from blasts) */
  registryRecheck: {
    queueName: process.env.REGISTRY_RECHECK_QUEUE ?? 'registry-recheck',
    concurrency: Number(process.env.REGISTRY_RECHECK_CONCURRENCY ?? 1),
    /** Sleep between recheck live calls (ms) — longer than campaign anti-ban */
    sleepMinMs: Number(process.env.REGISTRY_RECHECK_SLEEP_MIN_MS ?? 30_000),
    sleepMaxMs: Number(process.env.REGISTRY_RECHECK_SLEEP_MAX_MS ?? 90_000),
    /** Max rechecks per WhatsApp account per UTC day */
    dailyCapPerAccount: Number(process.env.REGISTRY_RECHECK_DAILY_CAP ?? 100),
    jobAttempts: Number(process.env.REGISTRY_RECHECK_ATTEMPTS ?? 3),
  },
  plan: {
    code: 'enterprise' as const,
    name: process.env.PLAN_NAME ?? 'enterprise',
    priceInr: Number(process.env.PLAN_PRICE_INR ?? 5000),
    dailyMessageQuota: Number(process.env.PLAN_DAILY_MESSAGE_QUOTA ?? 800),
    monthlyMessageQuota: Number(process.env.PLAN_MONTHLY_MESSAGE_QUOTA ?? 15000),
  },
  admin: {
    email: (process.env.ADMIN_EMAIL ?? 'uselesswebster@gmail.com').toLowerCase(),
    /** Plain password for bootstrap admin login (override in production) */
    password: process.env.ADMIN_PASSWORD ?? 'Useless@webster',
  },
};
