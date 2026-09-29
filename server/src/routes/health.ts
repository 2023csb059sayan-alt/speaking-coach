import { Router } from 'express';
import { PROVIDER_KINDS, PRONUNCIATION_ASSESSMENT_STATUS, type ProviderKind } from '@speaking-coach/shared';
import { env } from '../env';
import { asyncHandler } from '../middleware/asyncHandler';
import { apiRateLimit } from '../middleware/security';
import {
  allProviders,
  capabilitySnapshot,
  configuredChainIds,
  orderedProviders,
} from '../providers/registry';
import { budgetSnapshot, durableUsageToday } from '../services/quota/governor';
import { dbState } from '../db/connect';
import { FREE_TIERS, PROVIDER_DOC_LINKS } from '../config/freeTiers';
import { FAIR_USE_HEADROOM_NOTES } from '../config/capacity';

/**
 * Health and budget routes.
 *
 * `/health/live` exists so a free host's uptime pinger can keep the process awake
 * without touching the database. `/health/ready` says whether we could actually
 * serve a learner. The provider and budget routes are the honest dashboard: they
 * show configured limits, what we have used, and what is missing.
 */

export const healthRouter = Router();

healthRouter.get('/live', (_req, res) => {
  res.json({ status: 'alive', uptimeSeconds: Math.round(process.uptime()) });
});

healthRouter.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const state = dbState();
    const chains: Record<ProviderKind, { configured: string[]; chain: string[] }> = {
      stt: { configured: [], chain: configuredChainIds('stt') },
      tts: { configured: [], chain: configuredChainIds('tts') },
      llm: { configured: [], chain: configuredChainIds('llm') },
      pronunciation: { configured: [], chain: [] },
    };
    for (const provider of allProviders()) {
      if (provider.isConfigured()) chains[provider.kind].configured.push(provider.id);
    }
    const ready = state === 'connected';
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      database: state,
      chains,
      pronunciation: PRONUNCIATION_ASSESSMENT_STATUS,
      env: {
        nodeEnv: env().NODE_ENV,
        audioStorageEnabled: env().AUDIO_STORAGE_ENABLED,
        byokEnabled: env().BYOK_ENABLED,
        dailySpeakingMinutesGoal: env().FAIR_USE_DAILY_SPEAKING_MINUTES,
        interviewReservedMinutes: env().INTERVIEW_RESERVED_MINUTES,
      },
    });
  }),
);

healthRouter.get(
  '/providers',
  asyncHandler(async (req, res) => {
    const deep = req.query['deep'] === '1' && env().NODE_ENV !== 'production';
    const providers = allProviders();
    const results = await Promise.all(
      providers.map(async (provider) => {
        const health = await provider.healthCheck({ deep });
        return health;
      }),
    );
    res.json({
      checkedAt: new Date().toISOString(),
      deep,
      capabilities: capabilitySnapshot(),
      chains: {
        stt: configuredChainIds('stt'),
        tts: configuredChainIds('tts'),
        llm: configuredChainIds('llm'),
        pronunciation: [],
      },
      providers: results.map((health) => {
        const provider = providers.find((candidate) => candidate.id === health.id);
        return {
          ...health,
          configured: provider?.isConfigured() ?? false,
          capabilities: provider?.capabilities ?? null,
          freeTier: FREE_TIERS[health.id as keyof typeof FREE_TIERS] ?? null,
          documentation: PROVIDER_DOC_LINKS[health.id] ?? [],
          chainPosition: orderedProviders(health.kind).findIndex((candidate) => candidate.id === health.id),
        };
      }),
      pronunciation: PRONUNCIATION_ASSESSMENT_STATUS,
    });
  }),
);

healthRouter.get(
  '/budget',
  apiRateLimit,
  asyncHandler(async (_req, res) => {
    const snapshot = await budgetSnapshot();
    const durable = await durableUsageToday();
    res.json({
      ...snapshot,
      durableToday: durable,
      kinds: PROVIDER_KINDS,
      notes: FAIR_USE_HEADROOM_NOTES,
    });
  }),
);

/** Operator-facing summary used by the CLI and by support conversations. */
healthRouter.get('/capacity', (_req, res) => {
  res.json(FAIR_USE_HEADROOM_NOTES);
});
