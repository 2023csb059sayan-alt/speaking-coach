/**
 * A single clock for quota accounting.
 *
 * Tests replace it so rolling windows and circuit-breaker cooldowns can be
 * exercised without sleeping.
 */

let clock: () => number = () => Date.now();

export function nowMs(): number {
  return clock();
}

export function setClock(fn: () => number): void {
  clock = fn;
}

export function resetClock(): void {
  clock = () => Date.now();
}

/** UTC day key in YYYY-MM-DD form, matching the ProviderUsage ledger. */
export function utcDayKey(at: number = nowMs()): string {
  return new Date(at).toISOString().slice(0, 10);
}
