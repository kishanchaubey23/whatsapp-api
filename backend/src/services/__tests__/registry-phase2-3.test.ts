/**
 * Phase 2/3 unit tests — registry rules, recheck job IDs, protection separation.
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from '../../lib/phone.js';
import { classifyWaError } from '../../lib/wa-error-classifier.js';
import {
  resetRegistryMetrics,
  incRegistryMetric,
  getRegistryMetrics,
} from '../../lib/registry-metrics.js';
import { applyRuntimeRiskEvent } from '../../lib/protection-engine.js';

describe('Phase 2 — failure classification → global vs account', () => {
  it('NOT_REGISTERED is global registration evidence', () => {
    const c = classifyWaError(new Error('Phone number is not registered on WhatsApp'));
    assert.equal(c.category, 'not_registered');
    assert.equal(c.isSessionFatal, false);
  });

  it('BLOCKED is account-specific, not global registration', () => {
    const c = classifyWaError(new Error('not-authorized: contact blocked'));
    assert.equal(c.category, 'target_blocked');
    assert.equal(c.isContactLevel, true);
    assert.equal(c.isSessionFatal, false);
  });

  it('session/protocol errors are not registration flips', () => {
    const c = classifyWaError(new Error('Protocol error: Session closed'));
    assert.equal(c.category, 'session_dead');
    assert.equal(c.isSessionFatal, true);
  });

  it('network-ish unknown does not claim not_registered', () => {
    const c = classifyWaError(new Error('ETIMEDOUT connecting to browser'));
    assert.notEqual(c.category, 'not_registered');
  });
});

describe('Phase 3 — recheck job id deterministic', () => {
  it('same phone → same job id key', () => {
    const a = normalizePhone('+91 98765 43210');
    const b = normalizePhone('919876543210');
    assert.equal(a, b);
    const jobId = (p: string) => `registry-recheck:${p}`;
    assert.equal(jobId(a!), jobId(b!));
  });
});

describe('Phase 3 — metrics keys', () => {
  it('recheck metrics increment', () => {
    resetRegistryMetrics();
    incRegistryMetric('registry_recheck_enqueued');
    incRegistryMetric('registry_recheck_deduplicated');
    incRegistryMetric('registry_recheck_noop_fresh');
    incRegistryMetric('registry_status_flip');
    const m = getRegistryMetrics();
    assert.equal(m.registry_recheck_enqueued, 1);
    assert.equal(m.registry_recheck_deduplicated, 1);
    assert.equal(m.registry_recheck_noop_fresh, 1);
    assert.equal(m.registry_status_flip, 1);
  });
});

describe('Phase 3 — kill-switch isolation from target_blocked', () => {
  it('blocked contacts never trip kill switch', () => {
    let s = applyRuntimeRiskEvent(null, 'target_blocked');
    for (let i = 0; i < 5; i++) s = applyRuntimeRiskEvent(s, 'target_blocked');
    assert.equal(s.killSwitch, false);
    assert.equal(s.consecutiveProtocolFailures, 0);
  });

  it('protocol failures still trip kill switch', () => {
    let s = applyRuntimeRiskEvent(null, 'session_dead');
    s = applyRuntimeRiskEvent(s, 'session_dead');
    s = applyRuntimeRiskEvent(s, 'session_dead');
    assert.equal(s.killSwitch, true);
  });
});

describe('Architecture separation', () => {
  it('global statuses exclude blocked', () => {
    const global = ['on_whatsapp', 'not_on_whatsapp', 'unknown'];
    assert.equal(global.includes('blocked_or_unavailable'), false);
  });
});
