import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { apiRateLimit } from '../middleware/security';
import { requireAuth, requireClientHeader } from '../middleware/auth';
import { VocabularyCardModel, DrillSessionModel, DailyPlanModel } from '../models';
import { computeSm2, getDueCards, getVocabularyStats, addVocabularyCard, type Sm2Output } from '../services/sm2';
import { getDrillPrompts, computeWpm, countFillers } from '../services/drills';
import { getTodaysPlan, completeActivity, getStreak, generateProgressSnapshot, getProgressHistory } from '../services/progress';
import { logger } from '../logging';

/**
 * Vocabulary, Drills, Daily Plans, Progress routes.
 *
 * All routes require authentication (httpOnly cookie) and the x-sc-client header.
 */

export const progressRouter = Router();

progressRouter.use(requireClientHeader);
progressRouter.use(apiRateLimit);
progressRouter.use(requireAuth);

// ============================================================================
// VOCABULARY (SM-2)
// ============================================================================

/**
 * GET /api/vocabulary/due
 * Get cards due for review today.
 */
progressRouter.get(
  '/vocabulary/due',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const cards = await getDueCards(userId, limit);
    res.json({ cards, count: cards.length });
  }),
);

/**
 * GET /api/vocabulary/stats
 * Get vocabulary statistics.
 */
progressRouter.get(
  '/vocabulary/stats',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const stats = await getVocabularyStats(userId);
    res.json(stats);
  }),
);

/**
 * POST /api/vocabulary
 * Add a new vocabulary card.
 */
progressRouter.post(
  '/vocabulary',
  asyncHandler(async (req, res) => {
    const body = vocabAddSchema.parse(req.body);
    const userId = req.auth!.userId;
    const card = await addVocabularyCard(userId, body);
    res.status(201).json({ card });
  }),
);

/**
 * POST /api/vocabulary/review
 * Submit a review grade for a card (SM-2).
 */
progressRouter.post(
  '/vocabulary/review',
  asyncHandler(async (req, res) => {
    const body = vocabReviewSchema.parse(req.body);
    const userId = req.auth!.userId;

    const card = await VocabularyCardModel.findOne({ _id: body.cardId, userId });
    if (!card) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Card not found' } });
    }

    const result: Sm2Output = computeSm2({
      easinessFactor: card.easinessFactor,
      intervalDays: card.intervalDays,
      repetitions: card.repetitions,
      grade: body.grade,
    });

    // Update card
    card.easinessFactor = result.easinessFactor;
    card.intervalDays = result.intervalDays;
    card.repetitions = result.repetitions;
    card.nextReviewAt = result.nextReviewAt;
    card.lastReviewedAt = new Date();
    card.reviewCount += 1;
    if (result.lapse) card.lapseCount += 1;
    await card.save();

    logger.info({ userId, cardId: card._id, grade: body.grade, success: result.success }, 'Vocabulary review');

    res.json({
      card: {
        _id: card._id,
        easinessFactor: card.easinessFactor,
        intervalDays: card.intervalDays,
        repetitions: card.repetitions,
        nextReviewAt: card.nextReviewAt,
      },
      result,
    });
  }),
);

/**
 * GET /api/vocabulary
 * List user's vocabulary cards (paginated).
 */
progressRouter.get(
  '/vocabulary',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const tag = req.query.tag as string | undefined;

    const filter: Record<string, unknown> = { userId };
    if (tag) filter.tags = tag;

    const [cards, total] = await Promise.all([
      VocabularyCardModel.find(filter)
        .sort({ nextReviewAt: 1 })
        .skip(offset)
        .limit(limit)
        .lean(),
      VocabularyCardModel.countDocuments(filter),
    ]);

    res.json({ cards, pagination: { total, limit, offset } });
  }),
);

/**
 * DELETE /api/vocabulary/:id
 * Delete a vocabulary card.
 */
progressRouter.delete(
  '/vocabulary/:id',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    await VocabularyCardModel.findOneAndDelete({ _id: req.params.id, userId });
    res.json({ message: 'Card deleted' });
  }),
);

// ============================================================================
// DRILLS
// ============================================================================

/**
 * GET /api/drills/prompts
 * Get prompts for a drill configuration.
 */
progressRouter.get(
  '/drills/prompts',
  asyncHandler(async (req, res) => {
    const config = drillConfigSchema.parse(req.query);
    const prompts = getDrillPrompts(config);
    res.json({ prompts, count: prompts.length });
  }),
);

/**
 * POST /api/drills
 * Start a drill session.
 */
progressRouter.post(
  '/drills',
  asyncHandler(async (req, res) => {
    const body = drillStartSchema.parse(req.body);
    const userId = req.auth!.userId;

    const prompts = getDrillPrompts(body.config);

    const session = await DrillSessionModel.create({
      userId,
      type: body.config.type,
      config: body.config,
      status: 'active',
      prompts,
      responses: [],
      metrics: null,
      startedAt: new Date(),
    });

    logger.info({ userId, sessionId: session._id, type: body.config.type }, 'Drill session started');

    res.status(201).json({
      sessionId: session._id,
      prompts: session.prompts,
      config: session.config,
    });
  }),
);

/**
 * PATCH /api/drills/:id/response
 * Submit a response for a drill prompt.
 */
progressRouter.patch(
  '/drills/:id/response',
  asyncHandler(async (req, res) => {
    const body = drillResponseSchema.parse(req.body);
    const userId = req.auth!.userId;

    const session = await DrillSessionModel.findOne({ _id: req.params.id, userId, status: 'active' });
    if (!session) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Active drill session not found' } });
    }

    if (body.promptIndex >= session.prompts.length) {
      return res.status(400).json({ error: { code: 'bad_request', message: 'Invalid prompt index' } });
    }

    // Compute metrics
    const wpm = computeWpm(body.transcript, body.audioDurationMs);
    const fillerCount = countFillers(body.transcript);

    // Placeholder scoring - real implementation would use LLM evaluation
    const score = Math.max(0, 100 - fillerCount * 10 - Math.max(0, 150 - wpm) / 2);

    session.responses.push({
      promptIndex: body.promptIndex,
      transcript: body.transcript,
      audioDurationMs: body.audioDurationMs,
      score,
      fillerCount,
      wpm,
    });

    // Check if session is complete
    if (session.responses.length >= session.prompts.length) {
      session.status = 'completed';
      session.completedAt = new Date();

      // Compute aggregate metrics
      const validScores = session.responses.filter(r => r.score !== null).map(r => r.score!);
      session.metrics = {
        avgScore: validScores.length ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length) : null,
        totalFillers: session.responses.reduce((s, r) => s + r.fillerCount, 0),
        avgWpm: session.responses.length
          ? Math.round(session.responses.reduce((s, r) => s + (r.wpm ?? 0), 0) / session.responses.length)
          : null,
        completionRate: session.responses.length / session.prompts.length,
      };
    }

    await session.save();

    res.json({
      response: {
        promptIndex: body.promptIndex,
        score,
        fillerCount,
        wpm,
      },
      isComplete: session.status === 'completed',
      metrics: session.metrics,
    });
  }),
);

/**
 * GET /api/drills
 * List user's drill sessions.
 */
progressRouter.get(
  '/drills',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const type = req.query.type as string | undefined;
    const status = req.query.status as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const filter: Record<string, unknown> = { userId };
    if (type) filter.type = type;
    if (status) filter.status = status;

    const [sessions, total] = await Promise.all([
      DrillSessionModel.find(filter)
        .sort({ startedAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean(),
      DrillSessionModel.countDocuments(filter),
    ]);

    res.json({ sessions, pagination: { total, limit, offset } });
  }),
);

/**
 * GET /api/drills/:id
 * Get a drill session with responses.
 */
progressRouter.get(
  '/drills/:id',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const session = await DrillSessionModel.findOne({ _id: req.params.id, userId }).lean();
    if (!session) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Drill session not found' } });
    }
    res.json({ session });
  }),
);

// ============================================================================
// DAILY PLANS
// ============================================================================

/**
 * GET /api/daily-plan/today
 * Get today's daily plan (creates if not exists).
 */
progressRouter.get(
  '/daily-plan/today',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const plan = await getTodaysPlan(userId);
    res.json({ plan });
  }),
);

/**
 * POST /api/daily-plan/today/complete
 * Mark an activity as completed.
 */
progressRouter.post(
  '/daily-plan/today/complete',
  asyncHandler(async (req, res) => {
    const body = activityCompleteSchema.parse(req.body);
    const userId = req.auth!.userId;
    const today = new Date();

    const plan = await completeActivity(userId, today, body.activityOrder, body.actualDurationMin);
    if (!plan) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Plan or activity not found' } });
    }

    res.json({ plan });
  }),
);

/**
 * GET /api/daily-plan/history
 * Get daily plan history.
 */
progressRouter.get(
  '/daily-plan/history',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);
    const endDate = new Date();
    endDate.setUTCHours(23, 59, 59, 999);

    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days + 1);
    startDate.setUTCHours(0, 0, 0, 0);

    const plans = await DailyPlanModel.find({
      userId,
      date: { $gte: startDate, $lte: endDate },
    }).sort({ date: -1 }).lean();

    res.json({ plans });
  }),
);

// ============================================================================
// STREAKS
// ============================================================================

/**
 * GET /api/streak
 * Get current streak info.
 */
progressRouter.get(
  '/streak',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const streak = await getStreak(userId);
    res.json({ streak });
  }),
);

/**
 * POST /api/streak/freeze
 * Use a freeze token (if available).
 */
progressRouter.post(
  '/streak/freeze',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const { StreakModel } = await import('../models');

    const streak = await StreakModel.findOne({ userId });
    if (!streak) {
      return res.status(404).json({ error: { code: 'not_found', message: 'No streak found' } });
    }

    if (streak.freezeTokens <= 0) {
      return res.status(400).json({ error: { code: 'bad_request', message: 'No freeze tokens available' } });
    }

    streak.freezeTokens -= 1;
    await streak.save();

    res.json({ streak: { freezeTokens: streak.freezeTokens } });
  }),
);

// ============================================================================
// PROGRESS CHARTS
// ============================================================================

/**
 * GET /api/progress/history
 * Get progress snapshots for charts (last N days).
 */
progressRouter.get(
  '/progress/history',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);

    // Ensure we have today's snapshot
    await generateProgressSnapshot(userId);

    const snapshots = await getProgressHistory(userId, days);

    // Transform for charting
    const chartData = {
      speaking: {
        sci: snapshots.map(s => ({ date: s.date, value: s.speaking.avgSci })),
        fluency: snapshots.map(s => ({ date: s.date, value: s.speaking.avgFluency })),
        accuracy: snapshots.map(s => ({ date: s.date, value: s.speaking.avgAccuracy })),
        composure: snapshots.map(s => ({ date: s.date, value: s.speaking.avgComposure })),
      },
      vocabulary: {
        totalCards: snapshots.map(s => ({ date: s.date, value: s.vocabulary.totalCards })),
        dueCards: snapshots.map(s => ({ date: s.date, value: s.vocabulary.dueCards })),
        retentionRate: snapshots.map(s => ({ date: s.date, value: s.vocabulary.retentionRate })),
        avgEasinessFactor: snapshots.map(s => ({ date: s.date, value: s.vocabulary.avgEasinessFactor })),
      },
      drills: {
        avgScore: snapshots.map(s => ({ date: s.date, value: s.drills.avgScore })),
        totalFillers: snapshots.map((s: typeof snapshots[0]) => ({ date: s.date, value: s.drills.totalFillers })),
        avgWpm: snapshots.map((s: typeof snapshots[0]) => ({ date: s.date, value: s.drills.avgWpm })),
      },
      interview: {
        avgReadiness: snapshots.map((s: typeof snapshots[0]) => ({ date: s.date, value: s.interview.avgReadiness })),
      },
      streak: {
        current: snapshots.map((s: typeof snapshots[0]) => ({ date: s.date, value: s.streak.current })),
        longest: snapshots.map((s: typeof snapshots[0]) => ({ date: s.date, value: s.streak.longest })),
      },
    };

    res.json({ chartData, raw: snapshots });
  }),
);

/**
 * POST /api/progress/snapshot
 * Manually trigger snapshot generation for today.
 */
progressRouter.post(
  '/progress/snapshot',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const snapshot = await generateProgressSnapshot(userId);
    res.json({ snapshot });
  }),
);

/** Validation schemas */
const vocabAddSchema = z.object({
  term: z.string().min(1).max(100),
  definition: z.string().min(1).max(500),
  example: z.string().max(500).optional(),
  ipa: z.string().max(100).optional(),
  tags: z.array(z.string().max(50)).optional(),
  source: z.string().min(1).max(50),
  sourceRefId: z.string().optional(),
});

const vocabReviewSchema = z.object({
  cardId: z.string().min(1),
  grade: z.number().int().min(0).max(5),
});

const drillConfigSchema = z.object({
  type: z.enum(['pronunciation', 'fluency', 'fillers', 'grammar_patterns', 'vocabulary', 'shadowing', 'intotation', 'rapid_response']),
  targetSound: z.string().optional(),
  grammarPattern: z.string().optional(),
  timeLimitSec: z.number().int().positive().max(600).optional(),
  promptCount: z.number().int().positive().max(50).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
});

const drillStartSchema = z.object({
  config: drillConfigSchema,
});

const drillResponseSchema = z.object({
  promptIndex: z.number().int().nonnegative(),
  transcript: z.string().min(1).max(8000),
  audioDurationMs: z.number().int().positive(),
});

const activityCompleteSchema = z.object({
  activityOrder: z.number().int().nonnegative(),
  actualDurationMin: z.number().int().positive(),
});