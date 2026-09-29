import type { FreeQuota, FreeQuotaLimit, QuotaUnit, QuotaWindow } from '@speaking-coach/shared';
import { nowMs } from './clock';

/**
 * In-memory rolling-window usage ledger.
 *
 * Rolling windows are used for every limit, including the daily ones, even though
 * some providers reset on a fixed boundary. That is deliberate: a rolling window is
 * never more generous than the provider's own reset, so we can never overshoot and
 * get blocked. The cost is that our budget panel is slightly conservative.
 */

const WINDOW_MS: Record<QuotaWindow, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  // A month is treated as 30 days. Providers do not publish a rolling month, so we
  // pick the shortest plausible interpretation and stay on the safe side.
  month: 30 * 86_400_000,
};

export interface UsageEntry {
  unit: QuotaUnit;
  amount: number;
}

interface LedgerEvent {
  at: number;
  unit: QuotaUnit;
  amount: number;
}

export interface LimitStatus extends FreeQuotaLimit {
  used: number;
  remaining: number;
  percentUsed: number;
  exhausted: boolean;
}

export class SlidingWindowLedger {
  private events: LedgerEvent[] = [];

  record(entries: UsageEntry[], at: number = nowMs()): void {
    this.prune(at);
    for (const entry of entries) {
      if (entry.amount <= 0) continue;
      this.events.push({ at, unit: entry.unit, amount: entry.amount });
    }
  }

  used(unit: QuotaUnit, window: QuotaWindow, at: number = nowMs()): number {
    const span = WINDOW_MS[window];
    let total = 0;
    for (const event of this.events) {
      if (event.unit === unit && at - event.at < span) total += event.amount;
    }
    return total;
  }

  statusFor(limit: FreeQuotaLimit, at: number = nowMs()): LimitStatus {
    const used = this.used(limit.unit, limit.window, at);
    const remaining = Math.max(0, limit.limit - used);
    return {
      ...limit,
      used,
      remaining,
      percentUsed: limit.limit === 0 ? 100 : Math.min(100, Math.round((used / limit.limit) * 1000) / 10),
      exhausted: remaining <= 0,
    };
  }

  statusesFor(quota: FreeQuota | null, at: number = nowMs()): LimitStatus[] {
    if (!quota) return [];
    return quota.limits.map((limit) => this.statusFor(limit, at));
  }

  /**
   * The first limit that the given usage would exhaust, or null when everything
   * still fits. `estimated` is what we expect to spend, so a call that would take
   * the last token in the daily allowance is skipped instead of fired and failed.
   */
  blockingLimit(quota: FreeQuota | null, estimated: UsageEntry[], at: number = nowMs()): LimitStatus | null {
    if (!quota) return null;
    for (const limit of quota.limits) {
      const relevant = estimated.filter((entry) => entry.unit === limit.unit).reduce((sum, e) => sum + e.amount, 0);
      const used = this.used(limit.unit, limit.window, at);
      if (used + relevant > limit.limit) return this.statusFor(limit, at);
    }
    return null;
  }

  /** Highest usage across all windows for a unit, used when estimating cost. */
  reset(): void {
    this.events = [];
  }

  private prune(at: number): void {
    const oldest = at - WINDOW_MS.month;
    if (this.events.length === 0) return;
    if (this.events[0]!.at >= oldest) return;
    this.events = this.events.filter((event) => event.at >= oldest);
  }
}
