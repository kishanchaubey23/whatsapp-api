import { prisma } from '../lib/prisma.js';

export type IncomingMessageContext = {
  accountId: string;
  fromPhone: string;
  body: string;
  isGroup: boolean;
  fromMe: boolean;
};

function matchesKeyword(
  body: string,
  keyword: string,
  matchType: 'contains' | 'exact' | 'starts_with',
): boolean {
  const text = body.trim().toLowerCase();
  const kw = keyword.trim().toLowerCase();
  if (!kw) return false;
  if (matchType === 'exact') return text === kw;
  if (matchType === 'starts_with') return text.startsWith(kw);
  return text.includes(kw);
}

/**
 * Evaluate active rules for an account against an inbound text message.
 * Returns the winning rule (lowest priority number, then oldest).
 */
export async function findMatchingAutoReply(ctx: IncomingMessageContext) {
  if (ctx.fromMe || ctx.isGroup || !ctx.body?.trim()) return null;

  const rules = await prisma.autoReplyRule.findMany({
    where: {
      whatsappAccountId: ctx.accountId,
      isActive: true,
    },
    include: { keywords: true },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });

  if (rules.length === 0) return null;

  for (const rule of rules) {
    // No keywords → match any inbound message
    const keywordHit =
      rule.keywords.length === 0
        ? { keyword: null as string | null, ok: true }
        : (() => {
            for (const k of rule.keywords) {
              if (matchesKeyword(ctx.body, k.keyword, k.matchType)) {
                return { keyword: k.keyword, ok: true };
              }
            }
            return { keyword: null as string | null, ok: false };
          })();

    if (!keywordHit.ok) continue;

    if (rule.cooldownMinutes > 0) {
      const since = new Date(Date.now() - rule.cooldownMinutes * 60_000);
      const recent = await prisma.autoReplyLog.findFirst({
        where: {
          ruleId: rule.id,
          fromPhone: ctx.fromPhone,
          createdAt: { gte: since },
        },
        select: { id: true },
      });
      if (recent) continue;
    }

    return {
      rule,
      matchedKeyword: keywordHit.keyword,
    };
  }

  return null;
}

export async function recordAutoReplySent(params: {
  userId: string;
  ruleId: string;
  whatsappAccountId: string;
  fromPhone: string;
  matchedKeyword: string | null;
  incomingPreview: string;
}) {
  await prisma.$transaction([
    prisma.autoReplyLog.create({
      data: {
        userId: params.userId,
        ruleId: params.ruleId,
        whatsappAccountId: params.whatsappAccountId,
        fromPhone: params.fromPhone,
        matchedKeyword: params.matchedKeyword,
        incomingPreview: params.incomingPreview.slice(0, 280),
      },
    }),
    prisma.autoReplyRule.update({
      where: { id: params.ruleId },
      data: { responseCount: { increment: 1 } },
    }),
  ]);
}

export async function getAutoReplyStats(userId: string) {
  const [totalRules, activeRules, inactiveRules, responseAgg] = await Promise.all([
    prisma.autoReplyRule.count({ where: { userId } }),
    prisma.autoReplyRule.count({ where: { userId, isActive: true } }),
    prisma.autoReplyRule.count({ where: { userId, isActive: false } }),
    prisma.autoReplyRule.aggregate({
      where: { userId },
      _sum: { responseCount: true },
    }),
  ]);

  return {
    totalRules,
    activeRules,
    inactiveRules,
    totalResponses: responseAgg._sum.responseCount ?? 0,
  };
}
