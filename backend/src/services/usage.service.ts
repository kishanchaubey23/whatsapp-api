import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';

function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export async function getOrCreateUsageDay(userId: string, day = todayKey()) {
  return prisma.usageDay.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day },
    update: {},
  });
}

export async function getUsageSummary(userId: string) {
  const day = todayKey();
  const usage = await getOrCreateUsageDay(userId, day);
  const monthPrefix = day.slice(0, 7);
  const monthRows = await prisma.usageDay.findMany({
    where: { userId, day: { startsWith: monthPrefix } },
  });
  const monthSent = monthRows.reduce((s, r) => s + r.messagesSent, 0);

  return {
    plan: {
      code: config.plan.code,
      name: config.plan.name,
      priceInr: config.plan.priceInr,
      dailyMessageQuota: config.plan.dailyMessageQuota,
      monthlyMessageQuota: config.plan.monthlyMessageQuota,
    },
    today: {
      day,
      messagesSent: usage.messagesSent,
      messagesFailed: usage.messagesFailed,
      campaignsRun: usage.campaignsRun,
      remainingDaily: Math.max(0, config.plan.dailyMessageQuota - usage.messagesSent),
    },
    month: {
      messagesSent: monthSent,
      remainingMonthly: Math.max(0, config.plan.monthlyMessageQuota - monthSent),
    },
  };
}

export async function assertWithinQuota(userId: string, additional: number) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.planActive || user.planCode !== 'enterprise') {
    return {
      ok: false as const,
      error: 'Admin approval required. Your account is on the Free Plan. Please contact admin to activate sending privileges.',
      summary: await getUsageSummary(userId),
    };
  }

  const summary = await getUsageSummary(userId);
  if (additional > summary.today.remainingDaily) {
    return {
      ok: false as const,
      error: `Daily enterprise quota exceeded (${summary.plan.dailyMessageQuota}/day). Remaining today: ${summary.today.remainingDaily}.`,
      summary,
    };
  }
  if (additional > summary.month.remainingMonthly) {
    return {
      ok: false as const,
      error: `Monthly enterprise quota exceeded (${summary.plan.monthlyMessageQuota}/month).`,
      summary,
    };
  }
  return { ok: true as const, summary };
}

export async function recordSends(userId: string, sent: number, failed = 0, campaigns = 0) {
  const day = todayKey();
  await prisma.usageDay.upsert({
    where: { userId_day: { userId, day } },
    create: {
      userId,
      day,
      messagesSent: sent,
      messagesFailed: failed,
      campaignsRun: campaigns,
    },
    update: {
      messagesSent: { increment: sent },
      messagesFailed: { increment: failed },
      campaignsRun: { increment: campaigns },
    },
  });
}
