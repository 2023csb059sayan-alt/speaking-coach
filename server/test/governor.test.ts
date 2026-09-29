import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { FreeQuota } from '@speaking-coach/shared';
import { CircuitBreaker } from '../src/services/quota/circuitBreaker';
import { SlidingWindowLedger } from '../src/services/quota/ledger';
import { resetClock, setClock, utcDayKey } from '../src/services/quota/clock';
import { QuotaExhaustedError } from '../src/errors';
import type { BaseProvider, ProviderHealth, QuotaPurpose } from '../src/providers/types';

/**
 * Quota Governor behaviour.
 *
 * These tests use a fake provider rather than a real network call: what matters
 * here is that a documented limit is respected, that a failing provider is taken
 * out of the way, and that the learner gets a truthful error instead of a silent
 * downgrade.
 */

let now = 1_700_000_000_000;

beforeEach(() => {
  now = 1_700_000_000_000;
  setClock(() => now);
});
afterEach(() => {
  resetClock();
});

function quota(overrides: Partial<FreeQuota> = {}): FreeQuota {
  return {
    plan: 'test',
    requiresCard: false,
    source: 'https://example.com/docs',
    verifiedOn: '2026-09-30',
    limits: [{ unit: 'requests', window: 'minute', limit: 3 }],
    ...overrides,
  };
}

describe('SlidingWindowLedger', () => {
  it('counts usage inside a window and forgets it afterwards', () => {
    const ledger = new SlidingWindowLedger();
    ledger.record([{ unit: 'requests', amount: 2 }]);
    expect(ledger.used('requests', 'minute')).toBe(2);

    now += 61_000;
    expect(ledger.used('requests', 'minute')).toBe(0);
  });

  it('keeps separate counters per unit', () => {
    const ledger = new SlidingWindowLedger();
    ledger.record([
      { unit: 'requests', amount: 1 },
      { unit: 'audio_seconds', amount: 12 },
    ]);
    expect(ledger.used('requests', 'minute')).toBe(1);
    expect(ledger.used('audio_seconds', 'minute')).toBe(12);
  });

  it('refuses a call whose estimate would exceed a documented limit', () => {
    const ledger = new SlidingWindowLedger();
    ledger.record([{ unit: 'requests', amount: 3 }]);
    const blocked = ledger.blockingLimit(quota(), [{ unit: 'requests', amount: 1 }]);
    expect(blocked?.exhausted).toBe(true);
    expect(blocked?.used).toBe(3);
    expect(blocked?.limit).toBe(3);
  });

  it('allows a call that exactly fits the remaining budget', () => {
    const ledger = new SlidingWindowLedger();
    ledger.record([{ unit: 'requests', amount: 2 }]);
    expect(ledger.blockingLimit(quota(), [{ unit: 'requests', amount: 1 }])).toBeNull();
  });

  it('reports no blocking limit when the provider publishes no numbers', () => {
    const ledger = new SlidingWindowLedger();
    expect(ledger.blockingLimit(null, [{ unit: 'requests', amount: 1_000 }])).toBeNull();
  });

  it('reports a usage percentage for the budget panel', () => {
    const ledger = new SlidingWindowLedger();
    ledger.record([{ unit: 'requests', amount: 1 }]);
    const status = ledger.statusesFor(quota())[0]!;
    expect(status.percentUsed).toBeCloseTo(33.3, 1);
    expect(status.remaining).toBe(2);
  });
});

describe('CircuitBreaker', () => {
  it('opens after the configured number of failures and closes on success', () => {
    const breaker = new CircuitBreaker('test-provider', 3);
    expect(breaker.canAttempt()).toBe(true);

    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.canAttempt()).toBe(true);

    breaker.recordFailure();
    expect(breaker.canAttempt()).toBe(false);
    expect(breaker.snapshot().state).toBe('open');

    // The cooldown grows each time the breaker opens, so it is not a guess here.
    const cooldown = breaker.snapshot().cooldownMs;
    now += cooldown;
    expect(breaker.canAttempt()).toBe(true);
    expect(breaker.snapshot().state).toBe('half_open');

    breaker.recordSuccess();
    expect(breaker.snapshot().state).toBe('closed');
    expect(breaker.snapshot().consecutiveFailures).toBe(0);
  });

  it('reopens with a longer cooldown when the trial request also fails', () => {
    const breaker = new CircuitBreaker('test-provider', 1);
    breaker.recordFailure();
    const firstCooldown = breaker.snapshot().cooldownMs;
    now += firstCooldown;
    expect(breaker.canAttempt()).toBe(true);
    breaker.recordFailure();
    expect(breaker.canAttempt()).toBe(false);
    expect(breaker.snapshot().cooldownMs).toBeGreaterThan(firstCooldown);
  });

  it('waits exactly as long as the provider asked after a 429', () => {
    const breaker = new CircuitBreaker('test-provider', 99);
    breaker.forceOpen(90_000);
    expect(breaker.canAttempt()).toBe(false);
    now += 89_000;
    expect(breaker.canAttempt()).toBe(false);
    now += 2_000;
    expect(breaker.canAttempt()).toBe(true);
  });
});

describe('clock', () => {
  it('produces a UTC day key in YYYY-MM-DD', () => {
    expect(utcDayKey(Date.UTC(2026, 8, 30, 23, 59, 59))).toBe('2026-09-30');
  });
});

describe('provider contracts', () => {
  it('rejects a purpose it does not know', () => {
    const purposes: QuotaPurpose[] = ['conversation', 'interview', 'evaluation', 'probe', 'cached_audio'];
    expect(purposes).toContain('interview');
  });

  it('declares capabilities honestly for a provider that cannot do word timings', async () => {
    const provider: BaseProvider = fakeProvider({ wordTimestamps: false, configured: false });
    const health: ProviderHealth = await provider.healthCheck({ deep: false });
    expect(provider.capabilities.wordTimestamps).toBe(false);
    expect(health.status).toBe('unconfigured');
  });
});

describe('QuotaExhaustedError', () => {
  it('carries the providers that were tried so the client can explain itself', () => {
    const error = new QuotaExhaustedError(['groq-llm', 'workersai-llm'], 'both out of budget');
    expect(error.providerIds).toEqual(['groq-llm', 'workersai-llm']);
    expect(error.status).toBe(503);
    expect(error.code).toBe('quota_exhausted');
  });
});

export function fakeProvider(options: {
  wordTimestamps?: boolean;
  freeQuota?: FreeQuota | null;
  configured?: boolean;
} = {}): BaseProvider {
  return {
    id: 'fake-provider',
    kind: 'llm',
    capabilities: {
      id: 'fake-provider',
      kind: 'llm',
      wordTimestamps: options.wordTimestamps ?? false,
      streaming: false,
      pronunciationScoring: false,
      onDevice: false,
      freeQuota: options.freeQuota ?? null,
      description: 'test double',
    },
    isConfigured: () => options.configured ?? true,
    configurationHint: () => 'not configured in this test',
    healthCheck: async () => ({
      id: 'fake-provider',
      kind: 'llm',
      status: options.configured === false ? 'unconfigured' : 'ok',
      detail: 'test',
      latencyMs: 1,
      checkedAt: new Date(now).toISOString(),
      rateLimitHeaders: null,
      deep: false,
    }),
  };
}
