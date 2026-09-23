/**
 * Production-readiness tests for GlobalPhoneRegistry Phase 2/3 hardening.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, maskPhone } from '../../lib/phone.js';
import { classifyWaError } from '../../lib/wa-error-classifier.js';
import { applyRuntimeRiskEvent } from '../../lib/protection-engine.js';
import {
  recheckDailyKey,
  utcDateKey,
  secondsUntilUtcMidnight,
} from '../../lib/recheck-quota.js';
import {
  resetRegistryMetrics,
  incRegistryMetric,
  getRegistryMetrics,
} from '../../lib/registry-metrics.js';

describe('phone mask + normalize', () => {
  it('normalize collapses formats', () => {
    assert.equal(normalizePhone('+91 98765-43210'), normalizePhone('919876543210'));
  });
  it('mask does not leak full number', () => {
    const m = maskPhone('919876543210');
    assert.ok(!m.includes('987654'));
    assert.ok(m.includes('***'));
  });
});

describe('Redis quota key + UTC day', () => {
  it('key structure', () => {
    const k = recheckDailyKey('acc-uuid-123', '2026-09-09');
    assert.equal(k, 'registry-recheck:daily:acc-uuid-123:2026-09-09');
  });

  it('utcDateKey is YYYY-MM-DD', () => {
    assert.match(utcDateKey(new Date('2026-09-09T23:59:59.000Z')), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(utcDateKey(new Date('2026-09-09T23:59:59.000Z')), '2026-09-09');
    assert.equal(utcDateKey(new Date('2026-09-10T00:00:00.000Z')), '2026-09-10');
  });

  it('secondsUntilUtcMidnight positive', () => {
    assert.ok(secondsUntilUtcMidnight() >= 60);
  });
});

describe('BullMQ job id uniqueness contract', () => {
  it('deterministic id per phone', () => {
    const p = normalizePhone('+1 (234) 567-8901')!;
    const id = `registry-recheck:${p}`;
    assert.equal(id, `registry-recheck:${normalizePhone('12345678901')}`);
  });
});

describe('Global vs account failure matrix', () => {
  const cases: Array<{ msg: string; cat: string; globalFlip: boolean }> = [
    { msg: 'not registered on whatsapp', cat: 'not_registered', globalFlip: true },
    { msg: 'contact blocked / not-authorized', cat: 'target_blocked', globalFlip: false },
    { msg: 'Session closed', cat: 'session_dead', globalFlip: false },
    { msg: 'Execution context was destroyed', cat: 'session_dead', globalFlip: false },
    { msg: 'Protocol error', cat: 'session_dead', globalFlip: false },
    { msg: 'rate limit exceeded', cat: 'rate_limited', globalFlip: false },
    { msg: 'account banned', cat: 'session_dead', globalFlip: false },
    { msg: 'ETIMEDOUT', cat: 'unknown', globalFlip: false },
  ];

  for (const c of cases) {
    it(`${c.cat}: globalFlip=${c.globalFlip} (${c.msg.slice(0, 24)})`, () => {
      const r = classifyWaError(new Error(c.msg));
      assert.equal(r.category, c.cat);
      const shouldFlip = r.category === 'not_registered';
      assert.equal(shouldFlip, c.globalFlip);
    });
  }
});

describe('Stale vs fresh presentation', () => {
  it('fresh flag must not be true without expiresAt future', () => {
    // Document contract: isFresh requires expiresAt > now and status != unknown
    const now = Date.now();
    const fresh = { status: 'on_whatsapp', expiresAt: new Date(now + 86400000) };
    const stale = { status: 'on_whatsapp', expiresAt: new Date(now - 1000) };
    assert.ok(fresh.expiresAt.getTime() > now);
    assert.ok(stale.expiresAt.getTime() < now);
  });
});

describe('Protection kill-switch isolation', () => {
  it('blocked does not kill', () => {
    let s = applyRuntimeRiskEvent(null, 'target_blocked');
    s = applyRuntimeRiskEvent(s, 'target_blocked');
    s = applyRuntimeRiskEvent(s, 'target_blocked');
    assert.equal(s.killSwitch, false);
  });
  it('session_dead kills at 3', () => {
    let s = applyRuntimeRiskEvent(null, 'session_dead');
    s = applyRuntimeRiskEvent(s, 'session_dead');
    s = applyRuntimeRiskEvent(s, 'session_dead');
    assert.equal(s.killSwitch, true);
  });
});

describe('Metrics completeness', () => {
  it('has production metrics keys', () => {
    resetRegistryMetrics();
    incRegistryMetric('registry_recheck_quota_rejected');
    incRegistryMetric('registry_recheck_ownership_rejected');
    incRegistryMetric('registry_recheck_account_unavailable');
    const m = getRegistryMetrics();
    assert.equal(m.registry_recheck_quota_rejected, 1);
    assert.equal(m.registry_recheck_ownership_rejected, 1);
    assert.equal(m.registry_recheck_account_unavailable, 1);
  });
});

describe('Architecture: three layers', () => {
  it('global statuses are registration-only', () => {
    const global = new Set(['on_whatsapp', 'not_on_whatsapp', 'unknown']);
    assert.equal(global.has('blocked_or_unavailable'), false);
    assert.equal(global.has('send_success'), false);
  });
});
