import { nowMs } from './clock';

/**
 * Circuit breaker, one per provider.
 *
 * A provider that keeps failing is taken out of the chain for a cooldown instead of
 * adding its timeout to every learner's wait. After the cooldown the breaker goes
 * half-open: one trial request is allowed through, and success closes it again.
 */

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface BreakerSnapshot {
  providerId: string;
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: number | null;
  retryAt: number | null;
  cooldownMs: number;
}

const BASE_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 10 * 60_000;

export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private cooldownMs = BASE_COOLDOWN_MS;
  private readonly threshold: number;

  constructor(
    readonly providerId: string,
    threshold = 3,
  ) {
    this.threshold = threshold;
  }

  /** True when a request may be attempted right now. Moves open -> half-open when due. */
  canAttempt(at: number = nowMs()): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'half_open') return true;
    if (this.openedAt === null) return true;
    if (at - this.openedAt >= this.cooldownMs) {
      this.state = 'half_open';
      return true;
    }
    return false;
  }

  retryAt(): number | null {
    if (this.state !== 'open' || this.openedAt === null) return null;
    return this.openedAt + this.cooldownMs;
  }

  recordSuccess(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.cooldownMs = BASE_COOLDOWN_MS;
  }

  recordFailure(at: number = nowMs()): void {
    this.consecutiveFailures += 1;
    if (this.state === 'half_open') {
      // The trial request failed: go back to open with a longer cooldown.
      this.open(at, true);
      return;
    }
    if (this.consecutiveFailures >= this.threshold) this.open(at, true);
  }

  /** Forced open, used when the provider tells us directly that we are out of quota. */
  forceOpen(durationMs: number, at: number = nowMs()): void {
    // The provider has told us how long to wait, so that number is the cooldown.
    // It must not be doubled, or we would idle twice as long as we were told to.
    this.cooldownMs = Math.min(MAX_COOLDOWN_MS, Math.max(this.cooldownMs, durationMs));
    this.open(at, false);
  }

  snapshot(): BreakerSnapshot {
    return {
      providerId: this.providerId,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAt,
      retryAt: this.state === 'open' ? this.retryAt() : null,
      cooldownMs: this.cooldownMs,
    };
  }

  reset(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.cooldownMs = BASE_COOLDOWN_MS;
  }

  private open(at: number, grow: boolean): void {
    if (grow) this.cooldownMs = Math.min(MAX_COOLDOWN_MS, this.cooldownMs * 2);
    this.state = 'open';
    this.openedAt = at;
  }
}
