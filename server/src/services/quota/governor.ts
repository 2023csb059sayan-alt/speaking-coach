import type { ProviderKind, QuotaUnit } from '@speaking-coach/shared';
import { ProviderUsageModel } from '../../models';
import { orderedProviders, allProviders } from '../../providers/registry';
import { ProviderHttpError, parseRetryAfter } from '../../providers/http';
import type { BaseProvider, ProviderHealth, QuotaPurpose } from '../../providers/types';
import { QUOTA_PURPOSE_PRIORITY } from '../../providers/types';
import { QuotaExhaustedError } from '../../errors';
import { logger } from '../../logging';
import { CircuitBreaker, type BreakerSnapshot } from './circuitBreaker';
import { nowMs, utcDayKey } from './clock';
import { SlidingWindowLedger, type LimitStatus, type UsageEntry } from './ledger';

/**
 * Quota Governor.
 *
 * The single gate between a learner and a paid-shaped API. It decides which
 * provider serves a call, refuses calls that would exceed a documented free limit,
 * remembers rate-limit headers so our own numbers stay honest, takes failing
 * providers out of the chain, and reports exactly how much shared budget is left.
 *
 * Two rules it never breaks:
 *   - a request is never silently upgraded to something that costs money;
 *   - when nothing is available it says so, so the client can offer offline work
 *     instead of pretending.
 */

export interface ProviderBudgetSnapshot {
  providerId: string;
  kind: ProviderKind;
  configured: boolean;
  configurationHint: string | null;
  position: number;
  /** Empty when the provider publishes no numeric free limit. */
  limits: LimitStatus[];
  breaker: BreakerSnapshot;
  lastHealth: ProviderHealth | null;
  usageToday: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    audioSeconds: number;
    characters: number;
    neurons: number;
    errors: number;
    quotaBlocks: number;
  } | null;
}

export interface BudgetSnapshot {
  generatedAt: string;
  dayKey: string;
  providers: ProviderBudgetSnapshot[];
  totals: {
    requests: number;
    audioSeconds: number;
    inputTokens: number;
    outputTokens: number;
    neurons: number;
  };
  /** True when at least one provider can serve each capability right now. */
  available: Record<ProviderKind, boolean>;
}

export interface GovernorCallOptions {
  purpose: QuotaPurpose;
  userApiKey?: string | undefined;
  /** What we expect to spend, checked before the call is made. */
  estimate?: UsageEntry[];
  signal?: AbortSignal | undefined;
  /**
   * Explicit chain, used by callers that already know which providers apply (and by
   * tests). When omitted the configured chain for the capability is used.
   */
  providers?: BaseProvider[] | undefined;
}

export interface GovernorOutcome<T> {
  providerId: string;
  result: T;
}

interface ProviderOutcome<T> {
  result: T;
  usage: UsageEntry[];
  rateLimitHeaders?: Record<string, string>;
}

const breakers = new Map<string, CircuitBreaker>();
const ledger = new SlidingWindowLedger();
const lastHealth = new Map<string, ProviderHealth>();

function breakerFor(providerId: string): CircuitBreaker {
  let breaker = breakers.get(providerId);
  if (!breaker) {
    breaker = new CircuitBreaker(providerId);
    breakers.set(providerId, breaker);
  }
  return breaker;
}

function standardRequestEntry(): UsageEntry {
  return { unit: 'requests', amount: 1 };
}

function withRequests(entries: UsageEntry[]): UsageEntry[] {
  return [standardRequestEntry(), ...entries];
}

/**
 * Try each provider in chain order until one succeeds.
 *
 * A provider is skipped when it is unconfigured, when its circuit breaker is open,
 * or when the estimated usage would exceed a documented free limit. When the
 * provider answers 429 we believe it immediately: the breaker opens and the next
 * provider is tried without wasting the learner's time.
 */
export async function runWithFallback<TProvider extends BaseProvider, TResult>(
  kind: ProviderKind,
  execute: (provider: TProvider, options: { userApiKey?: string; purpose: QuotaPurpose; signal?: AbortSignal }) => Promise<ProviderOutcome<TResult>>,
  options: GovernorCallOptions,
): Promise<GovernorOutcome<TResult>> {
  const chain = (options.providers ?? orderedProviders(kind)) as TProvider[];
  const tried: string[] = [];
  const problems: string[] = [];

  for (const provider of chain) {
    if (!provider.isConfigured()) {
      problems.push(`${provider.id}: ${provider.configurationHint() ?? 'not configured'}`);
      continue;
    }
    const breaker = breakerFor(provider.id);
    if (!breaker.canAttempt()) {
      problems.push(`${provider.id}: cooling down until ${new Date(breaker.retryAt() ?? 0).toISOString()}`);
      continue;
    }
    const quota = provider.capabilities.freeQuota;
    const estimate = withRequests(options.estimate ?? []);
    const blocked = ledger.blockingLimit(quota, estimate);
    if (blocked) {
      void persistUsage(provider.id, provider.kind, [], { quotaBlocks: 1 });
      problems.push(
        `${provider.id}: ${blocked.unit} per ${blocked.window} limit reached (${blocked.used}/${blocked.limit})`,
      );
      continue;
    }

    tried.push(provider.id);
    try {
      const outcome = await execute(provider, {
        userApiKey: options.userApiKey,
        purpose: options.purpose,
        signal: options.signal,
      });
      ledger.record(withRequests(outcome.usage));
      breaker.recordSuccess();
      applyRateLimitHeaders(provider.id, outcome.rateLimitHeaders);
      void persistUsage(provider.id, provider.kind, outcome.usage);
      return { providerId: provider.id, result: outcome.result };
    } catch (error) {
      if (error instanceof ProviderHttpError && error.isRateLimited) {
        const retryAfter = error.retryAfterMs ?? 60_000;
        breaker.forceOpen(retryAfter);
        void persistUsage(provider.id, provider.kind, [], { quotaBlocks: 1 });
        problems.push(`${provider.id}: reported rate limiting, cooling down for ${Math.round(retryAfter / 1000)}s`);
        logger.warn({ providerId: provider.id, retryAfterMs: retryAfter }, 'Provider reported rate limiting');
        continue;
      }
      breaker.recordFailure();
      void persistUsage(provider.id, provider.kind, [], { errors: 1 });
      problems.push(`${provider.id}: ${error instanceof Error ? error.message : 'unknown error'}`);
      logger.warn({ providerId: provider.id, err: error }, 'Provider call failed, trying the next one');
    }
  }

  logger.error({ kind, purpose: options.purpose, tried, problems }, 'No provider could serve the request');
  throw new QuotaExhaustedError(tried, problems.join(' | '));
}

/**
 * Take the provider's own rate-limit headers at face value. When a provider says
 * zero requests remain for the day, our ledger is told about the block so the
 * budget panel matches reality instead of our own optimistic arithmetic.
 */
export function applyRateLimitHeaders(providerId: string, headers: Record<string, string> | undefined): void {
  if (!headers) return;
  void persistUsage(providerId, undefined, [], { rateLimitHeaders: headers });
  const remainingKeys = Object.keys(headers).filter((key) => /remaining/i.test(key));
  const exhausted = remainingKeys.some((key) => {
    const value = headers[key];
    if (!value) return false;
    const numeric = Number.parseFloat(value);
    return Number.isFinite(numeric) && numeric <= 0;
  });
  if (!exhausted) return;

  const retryAfter = parseRetryAfter(headers['retry-after']);
  const resetHeader = Object.entries(headers).find(([key]) => /reset/i.test(key));
  let waitMs = retryAfter ?? 60_000;
  if (resetHeader) {
    const asEpochSeconds = Number.parseFloat(resetHeader[1]);
    if (Number.isFinite(asEpochSeconds) && asEpochSeconds > 1_000_000) {
      waitMs = Math.max(waitMs, asEpochSeconds * 1000 - nowMs());
    }
  }
  breakerFor(providerId).forceOpen(waitMs);
}

export function recordHealth(health: ProviderHealth): void {
  lastHealth.set(health.id, health);
  if (health.status === 'unreachable' || health.status === 'rejected') {
    breakerFor(health.id).recordFailure();
  } else if (health.status === 'ok') {
    breakerFor(health.id).recordSuccess();
  }
  void persistUsage(health.id, undefined, [], { errors: health.status === 'ok' ? 0 : 1 });
}

export function healthSnapshot(): Map<string, ProviderHealth> {
  return new Map(lastHealth);
}

/** Full picture for GET /health/budget and for the CLI report. */
export async function budgetSnapshot(): Promise<BudgetSnapshot> {
  const providers = allProviders();
  const totals = { requests: 0, audioSeconds: 0, inputTokens: 0, outputTokens: 0, neurons: 0 };
  const durable = await durableUsageToday();
  const chainPosition = new Map<string, number>();
  for (const kind of ['stt', 'tts', 'llm'] as ProviderKind[]) {
    orderedProviders(kind).forEach((provider, index) => chainPosition.set(provider.id, index));
  }

  const snapshots = providers.map<ProviderBudgetSnapshot>((provider) => {
    const breaker = breakerFor(provider.id);
    const limits = ledger.statusesFor(provider.capabilities.freeQuota);
    for (const limit of limits) {
      if (limit.unit === 'requests') totals.requests += limit.used;
      if (limit.unit === 'audio_seconds') totals.audioSeconds += limit.used;
      if (limit.unit === 'input_tokens') totals.inputTokens += limit.used;
      if (limit.unit === 'output_tokens') totals.outputTokens += limit.used;
      if (limit.unit === 'neurons') totals.neurons += limit.used;
    }
    return {
      providerId: provider.id,
      kind: provider.kind,
      configured: provider.isConfigured(),
      configurationHint: provider.configurationHint(),
      position: chainPosition.get(provider.id) ?? -1,
      limits,
      breaker: breaker.snapshot(),
      lastHealth: lastHealth.get(provider.id) ?? null,
      usageToday: durable[provider.id] ?? null,
    };
  });

  const available: Record<ProviderKind, boolean> = {
    stt: orderedProviders('stt').some((p) => p.isConfigured() && breakerFor(p.id).canAttempt()),
    tts: orderedProviders('tts').some((p) => p.isConfigured() && breakerFor(p.id).canAttempt()),
    llm: orderedProviders('llm').some((p) => p.isConfigured() && breakerFor(p.id).canAttempt()),
    pronunciation: false,
  };

  return {
    generatedAt: new Date(nowMs()).toISOString(),
    dayKey: utcDayKey(),
    providers: snapshots,
    totals,
    available,
  };
}
/** Daily numbers read back from MongoDB, used by the CLI and the dashboard. */
export async function durableUsageToday(): Promise<Record<string, BudgetSnapshot['providers'][number]['usageToday']>> {
  const rows = await ProviderUsageModel.find({ dayKey: utcDayKey() }).lean();
  const result: Record<string, BudgetSnapshot['providers'][number]['usageToday']> = {};
  for (const row of rows) {
    result[row.providerId] = {
      requests: row.requests,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      audioSeconds: row.audioSeconds,
      characters: row.characters,
      neurons: row.neurons,
      errors: row.errorCount,
      quotaBlocks: row.quotaBlocks,
    };
  }
  return result;
}

/**
 * Durable, best-effort write of today's usage. Never throws: losing a counter row
 * must not fail a learner's request, and the rolling window still protects us.
 */
async function persistUsage(
  providerId: string,
  kind: ProviderKind | undefined,
  usage: UsageEntry[],
  extra: { errors?: number; quotaBlocks?: number; rateLimitHeaders?: Record<string, string> } = {},
): Promise<void> {
  const increments: Record<string, number> = {};
  for (const entry of usage) {
    increments[entry.unit] = (increments[entry.unit] ?? 0) + entry.amount;
  }
  if (extra.errors) increments['errorCount'] = extra.errors;
  if (extra.quotaBlocks) increments['quotaBlocks'] = extra.quotaBlocks;
  try {
    const provider = allProviders().find((candidate) => candidate.id === providerId);
    await ProviderUsageModel.updateOne(
      { providerId, dayKey: utcDayKey() },
      {
        ...(Object.keys(increments).length > 0 ? { $inc: increments } : {}),
        $set: {
          kind: kind ?? provider?.kind ?? 'unknown',
          lastUsedAt: new Date(nowMs()),
          ...(extra.rateLimitHeaders ? { lastRateLimitHeaders: extra.rateLimitHeaders } : {}),
        },
        $setOnInsert: { providerId, dayKey: utcDayKey() },
      },
      { upsert: true },
    );
  } catch (error) {
    logger.warn({ providerId, err: error }, 'Could not persist provider usage counters');
  }
}

/** Test seam: clear all in-memory state between cases. */
export function resetGovernor(): void {
  breakers.clear();
  lastHealth.clear();
  ledger.reset();
}

export function ledgerForTests(): SlidingWindowLedger {
  return ledger;
}

export function breakerForTests(providerId: string): CircuitBreaker {
  return breakerFor(providerId);
}

export function purposePriority(purpose: QuotaPurpose): number {
  return QUOTA_PURPOSE_PRIORITY[purpose];
}

export type { UsageEntry, LimitStatus, QuotaUnit };
