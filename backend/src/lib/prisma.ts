import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

  // Handle serverless database connection closes gracefully
  client.$on('error' as never, (e: { message?: string }) => {
    if (e?.message?.includes('Closed') || e?.message?.includes('connection')) {
      console.warn('[Prisma] Closed connection detected. Reconnecting...');
      client.$connect().catch(() => undefined);
    }
  });

  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
