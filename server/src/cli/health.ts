import { connectDb, disconnectDb } from '../db/connect';
import { env } from '../env';
import { capabilitySnapshot, allProviders, configuredChainIds } from '../providers/registry';
import { budgetSnapshot, durableUsageToday } from '../services/quota/governor';
import { FAIR_USE_HEADROOM_NOTES } from '../config/capacity';

/**
 * Operator CLI: `npm run health:cli [-- --deep]`
 *
 * Prints, in plain text, which providers are configured, which are reachable, how
 * much of each documented free allowance is left today, and what breaks if a chain
 * has no working link. Exit code 1 when a required capability has no provider, so
 * it can be used as a deploy gate.
 */

function formatNumber(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value);
}

function bar(percentUsed: number, width = 12): string {
  const filled = Math.min(width, Math.round((percentUsed / 100) * width));
  return `${'#'.repeat(filled)}${'.'.repeat(width - filled)}`;
}

async function main(): Promise<void> {
  const deep = process.argv.includes('--deep');
  const config = env();
  await connectDb();

  process.stdout.write(`\nEnvironment: ${config.NODE_ENV}\n`);
  process.stdout.write(`Chains: stt=[${configuredChainIds('stt')}] tts=[${configuredChainIds('tts')}] llm=[${configuredChainIds('llm')}]\n`);
  process.stdout.write(`Capabilities: ${JSON.stringify(capabilitySnapshot())}\n`);

  process.stdout.write('\nProviders\n');
  process.stdout.write(`${'-'.repeat(78)}\n`);
  for (const provider of allProviders()) {
    const health = await provider.healthCheck({ deep });
    const configured = provider.isConfigured();
    process.stdout.write(
      `${health.status === 'ok' ? 'OK  ' : `${health.status.padEnd(5)}`} ${provider.id.padEnd(16)} ${configured ? 'configured' : 'not configured'}\n`,
    );
    process.stdout.write(`      ${health.detail}\n`);
    if (health.rateLimitHeaders && Object.keys(health.rateLimitHeaders).length > 0) {
      const headers = Object.entries(health.rateLimitHeaders)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');
      process.stdout.write(`      headers: ${headers}\n`);
    }
  }

  const snapshot = await budgetSnapshot();
  process.stdout.write(`\nFree budget remaining (${snapshot.dayKey})\n`);
  process.stdout.write(`${'-'.repeat(78)}\n`);
  for (const entry of snapshot.providers) {
    if (!entry.configured) continue;
    if (entry.limits.length === 0) {
      process.stdout.write(`${entry.providerId.padEnd(16)} no published numeric limit\n`);
      continue;
    }
    for (const limit of entry.limits) {
      process.stdout.write(
        `${entry.providerId.padEnd(16)} ${`${limit.unit}/${limit.window}`.padEnd(22)} ${bar(limit.percentUsed)} ${formatNumber(limit.remaining)}/${formatNumber(limit.limit)} left\n`,
      );
    }
    const durable = snapshot.providers.find((candidate) => candidate.providerId === entry.providerId)?.usageToday;
    if (durable) {
      process.stdout.write(
        `${''.padEnd(16)} persisted today: ${durable.requests} requests, ${durable.errors} errors, ${durable.quotaBlocks} quota blocks\n`,
      );
    }
  }

  const durable = await durableUsageToday();
  process.stdout.write('\nPersisted counters for today\n');
  process.stdout.write(`${'-'.repeat(78)}\n`);
  if (Object.keys(durable).length === 0) {
    process.stdout.write('No usage recorded yet.\n');
  } else {
    for (const [providerId, usage] of Object.entries(durable)) {
      if (!usage) continue;
      process.stdout.write(
        `${providerId.padEnd(16)} requests=${usage.requests} in=${usage.inputTokens} out=${usage.outputTokens} audio=${usage.audioSeconds}s neurons=${usage.neurons} errors=${usage.errors} blocks=${usage.quotaBlocks}\n`,
      );
    }
  }

  process.stdout.write('\nCapacity estimate\n');
  process.stdout.write(`${'-'.repeat(78)}\n`);
  for (const line of FAIR_USE_HEADROOM_NOTES.lines) {
    const learners = line.learnersServableAtAssumedUsage ?? null;
    process.stdout.write(
      `${line.providerId.padEnd(16)} ${learners === null ? 'fallback only' : `about ${learners} learners/day`} - ${line.basis}\n`,
    );
  }
  process.stdout.write(`\n${FAIR_USE_HEADROOM_NOTES.headline}\n\n`);

  const missing = (['stt', 'tts', 'llm'] as const).filter((kind) => !snapshot.available[kind]);
  if (missing.length > 0) {
    process.stdout.write(`No working provider for: ${missing.join(', ')}\n\n`);
    await disconnectDb();
    process.exit(1);
  }
  await disconnectDb();
  process.exit(0);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
