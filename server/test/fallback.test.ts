import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FreeQuota } from '@speaking-coach/shared';
import { ProviderHttpError } from '../src/providers/http';
import type { BaseProvider } from '../src/providers/types';
import { QuotaExhaustedError } from '../src/errors';
import { resetGovernor, runWithFallback, applyRateLimitHeaders, ledgerForTests } from '../src/services/quota/governor';
import { resetClock, setClock } from '../src/services/quota/clock';

/**
 * Fallback behaviour when a provider misbehaves.
 *
 * The rule under test: a learner either gets an answer from a provider that has
 * budget, or gets a truthful error. Nothing here silently spends money, and nothing
 * here pretends a call worked when it did not.
 */

let now = 1_700_000_000_000;

beforeEach(() => {
  now = 1_700_000_000_000;
  resetGovernor();
  setClock(() => now);
});

afterEach(() => {
  resetClock();
});

function provider(id: string, options: { freeQuota?: FreeQuota | null; configured?: boolean } = {}): BaseProvider {
  return {
    id,
    kind: 'llm',
    capabilities: {
      id,
      kind: 'llm',
      wordTimestamps: false,
      streaming: false,
      pronunciationScoring: false,
      onDevice: false,
      freeQuota: options.freeQuota ?? null,
      description: `test double for ${id}`,
    },
    isConfigured: () => options.configured ?? true,
    configurationHint: () => (options.configured === false ? `${id} has no key` : null),
    healthCheck: async () => ({
      id,
      kind: 'llm',
      status: 'ok',
      detail: 'test',
      latencyMs: 1,
      checkedAt: new Date(now).toISOString(),
      rateLimitHeaders: null,
      deep: false,
    }),
  };
}

const requestsPerMinute = (limit: number): FreeQuota => ({
  plan: 'test',
  requiresCard: false,
  source: 'https://example.com/docs',
  verifiedOn: '2026-09-30',
  limits: [{ unit: 'requests', window: 'minute', limit }],
});

describe('runWithFallback', () => {
  it('uses the first provider that succeeds', async () => {
    const outcome = await runWithFallback(
      'llm',
      async (chosen) => ({ result: `hello from ${chosen.id}`, usage: [{ unit: 'total_tokens', amount: 10 }] }),
      { purpose: 'conversation', providers: [provider('first'), provider('second')] },
    );
    expect(outcome.providerId).toBe('first');
    expect(outcome.result).toBe('hello from first');
  });

  it('moves to the next provider when one reports rate limiting', async () => {
    let firstWasCalled = false;
    const outcome = await runWithFallback(
      'llm',
      async (chosen) => {
        if (chosen.id === 'limited') {
          firstWasCalled = true;
          throw new ProviderHttpError({
            providerId: 'limited',
            status: 429,
            bodyText: '',
            rateLimitHeaders: { 'retry-after': '60' },
            message: 'limited: 429',
          });
        }
        return { result: 'answered by the fallback', usage: [] };
      },
      { purpose: 'conversation', providers: [provider('limited'), provider('spare')] },
    );

    expect(firstWasCalled).toBe(true);
    expect(outcome.providerId).toBe('spare');
  });

  it('skips a provider whose daily allowance is already spent, without calling it', async () => {
    let spentWasCalled = false;
    const outcome = await runWithFallback(
      'llm',
      async (chosen) => {
        if (chosen.id === 'spent') spentWasCalled = true;
        return { result: 'ok', usage: [] };
      },
      {
        purpose: 'conversation',
        providers: [provider('spent', { freeQuota: requestsPerMinute(0) }), provider('fresh')],
      },
    );

    expect(spentWasCalled).toBe(false);
    expect(outcome.providerId).toBe('fresh');
  });

  it('refuses a call whose estimate would exceed the remaining budget', async () => {
    let called = false;
    const outcome = await runWithFallback(
      'llm',
      async () => {
        called = true;
        return { result: 'ok', usage: [] };
      },
      {
        purpose: 'conversation',
        estimate: [{ unit: 'requests', amount: 5 }],
        providers: [provider('tight', { freeQuota: requestsPerMinute(3) }), provider('spare')],
      },
    );
    expect(called).toBe(true);
    expect(outcome.providerId).toBe('spare');
  });

  it('throws a truthful quota error when nothing can serve the request', async () => {
    await expect(
      runWithFallback(
        'llm',
        async () => ({ result: 'never', usage: [] }),
        { purpose: 'conversation', providers: [provider('down', { configured: false })] },
      ),
    ).rejects.toBeInstanceOf(QuotaExhaustedError);
  });

  it('counts every served call against the shared ledger', async () => {
    await runWithFallback(
      'llm',
      async () => ({ result: 'ok', usage: [{ unit: 'total_tokens', amount: 42 }] }),
      { purpose: 'conversation', providers: [provider('counted', { freeQuota: requestsPerMinute(100) })] },
    );

    expect(ledgerForTests().used('requests', 'minute')).toBe(1);
    expect(ledgerForTests().used('total_tokens', 'minute')).toBe(42);
  });
});

describe('applyRateLimitHeaders', () => {
  it('opens the circuit when a provider says nothing remains today', async () => {
    await expect(
      runWithFallback(
        'llm',
        async () => ({ result: 'ok', usage: [] }),
        { purpose: 'conversation', providers: [provider('p1', { freeQuota: requestsPerMinute(100) })] },
      ),
    ).resolves.toBeTruthy();

    applyRateLimitHeaders('p1', { 'x-ratelimit-remaining-requests': '0', 'retry-after': '120' });

    await expect(
      runWithFallback(
        'llm',
        async () => ({ result: 'ok', usage: [] }),
        {
          purpose: 'conversation',
          providers: [provider('p1', { freeQuota: requestsPerMinute(100) }), provider('p2')],
        },
      ),
    ).resolves.toMatchObject({ providerId: 'p2' });
  });
});
