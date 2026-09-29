import { env } from '../env';
import { logger } from '../logging';
import { allProviders } from '../providers/registry';
import { recordHealth } from './quota/governor';
import type { ProviderHealth } from '../providers/types';

/**
 * Scheduled provider probes.
 *
 * A shallow probe is a free metadata call that tells us whether the key still works
 * and roughly how fast the provider is. A deep probe makes one real, minimal
 * inference so the budget panel reflects the provider's own rate-limit headers.
 * Deep probes cost quota, so they run on a timer (or when DEEP_PROBE is on), never
 * on a learner request.
 */

export interface ProbeOptions {
  intervalMinutes: number;
  deep?: boolean;
}

export async function probeAllProviders(deep: boolean): Promise<ProviderHealth[]> {
  const results: ProviderHealth[] = [];
  for (const provider of allProviders()) {
    try {
      const health = await provider.healthCheck({ deep });
      recordHealth(health);
      results.push(health);
    } catch (error) {
      const health: ProviderHealth = {
        id: provider.id,
        kind: provider.kind,
        status: 'unknown',
        detail: error instanceof Error ? error.message : 'unknown error',
        latencyMs: null,
        checkedAt: new Date().toISOString(),
        rateLimitHeaders: null,
        deep,
      };
      recordHealth(health);
      results.push(health);
    }
  }
  return results;
}

export async function runScheduledProbes(options: ProbeOptions): Promise<void> {
  const intervalMs = Math.max(1, options.intervalMinutes) * 60 * 1000;
  const deep = options.deep ?? env().DEEP_PROBE;

  const tick = async (): Promise<void> => {
    const results = await probeAllProviders(deep);
    const failing = results.filter((health) => health.status !== 'ok' && health.status !== 'unconfigured');
    logger.info(
      { checked: results.length, failing: failing.length, deep },
      'Provider probe finished',
    );
  };

  // Give the server a moment to finish booting before the first probe.
  setTimeout(() => void tick(), 2_000).unref?.();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
}
