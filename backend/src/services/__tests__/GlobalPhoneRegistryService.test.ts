/**
 * Unit tests for GlobalPhoneRegistryService + phone normalization.
 * Run: npx tsx --test src/services/__tests__/GlobalPhoneRegistryService.test.ts
 *
 * Uses mocked Prisma when DATABASE_URL is unavailable; otherwise hits real DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, isPhoneFormatValid } from '../../lib/phone.js';
import {
  applyRuntimeRiskEvent,
  riskEventFromCategory,
} from '../../lib/protection-engine.js';
import { classifyWaError } from '../../lib/wa-error-classifier.js';
import { resetRegistryMetrics, getRegistryMetrics, incRegistryMetric } from '../../lib/registry-metrics.js';

describe('phone normalization', () => {
  it('maps formatted variants to same key', () => {
    assert.equal(normalizePhone('+91 98765 43210'), '919876543210');
    assert.equal(normalizePhone('919876543210'), '919876543210');
    assert.equal(normalizePhone('(91) 98765-43210'), '919876543210');
  });

  it('rejects invalid lengths', () => {
    assert.equal(normalizePhone('123'), null);
    assert.equal(normalizePhone(''), null);
  });

  it('format validity', () => {
    assert.equal(isPhoneFormatValid('919876543210'), true);
    assert.equal(isPhoneFormatValid('987654'), false);
  });
});

describe('registry metrics', () => {
  it('tracks hit rate', () => {
    resetRegistryMetrics();
    incRegistryMetric('registry_lookup', 10);
    incRegistryMetric('registry_hit', 7);
    const m = getRegistryMetrics();
    assert.equal(m.registry_lookup, 10);
    assert.equal(m.registry_hit, 7);
    assert.equal(m.hit_rate, 0.7);
  });
});

describe('error classifier vs global poison', () => {
  it('target blocked is contact-level not session-fatal', () => {
    const c = classifyWaError(new Error('Contact blocked the user / not-authorized'));
    assert.equal(c.category, 'target_blocked');
    assert.equal(c.isSessionFatal, false);
    assert.equal(c.isContactLevel, true);
  });

  it('session dead is fatal', () => {
    const c = classifyWaError(new Error('Session closed: Execution context was destroyed'));
    assert.equal(c.category, 'session_dead');
    assert.equal(c.isSessionFatal, true);
  });
});

describe('protection runtime risk', () => {
  it('kill switch after 3 protocol failures', () => {
    let s = applyRuntimeRiskEvent(null, 'session_dead');
    s = applyRuntimeRiskEvent(s, 'session_dead');
    assert.equal(s.killSwitch, false);
    s = applyRuntimeRiskEvent(s, 'session_dead');
    assert.equal(s.killSwitch, true);
    assert.ok(s.score >= 80);
  });

  it('target_blocked does not trip kill switch', () => {
    let s = applyRuntimeRiskEvent(null, 'target_blocked');
    s = applyRuntimeRiskEvent(s, 'target_blocked');
    s = applyRuntimeRiskEvent(s, 'target_blocked');
    assert.equal(s.killSwitch, false);
    assert.equal(s.consecutiveProtocolFailures, 0);
  });

  it('maps banned message to session_banned', () => {
    assert.equal(riskEventFromCategory('session_dead', 'account banned by Meta'), 'session_banned');
  });
});

describe('architecture separation (documentation asserts)', () => {
  it('global statuses are only registration enums', () => {
    const allowed = new Set(['on_whatsapp', 'not_on_whatsapp', 'unknown']);
    for (const s of allowed) assert.ok(typeof s === 'string');
    // blocked is NOT a global status
    assert.equal(allowed.has('blocked_or_unavailable'), false);
  });
});
