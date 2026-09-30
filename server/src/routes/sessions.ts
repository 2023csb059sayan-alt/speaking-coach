import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { apiRateLimit } from '../middleware/security';
import { requireAuth, requireClientHeader } from '../middleware/auth';
import { PracticeSessionModel, TurnModel, type IPracticeSession } from '../models';

/** Lean document shape returned by mongoose .lean() - avoids FlattenMaps issues */
import type { TurnEvidence } from '../models/PracticeSession';

interface LeanTurn {
  turnIndex: number;
  transcript: string;
  coachResponse: string;
  metrics: TurnMetrics | null;
  evidence: TurnEvidence;
  startedAt: Date;
  endedAt: Date;
}
import { computeSCI, computeSessionSummary, SCI_FORMULA_VERSION } from '../services/metrics';
import { logger } from '../logging';
import type { TurnMetrics } from '../models/PracticeSession';

/**
 * Session routes: practice sessions, turns, and reports.
 *
 * All routes require authentication (httpOnly cookie) and the x-sc-client header.
 */

export const sessionsRouter = Router();

sessionsRouter.use(requireClientHeader);
sessionsRouter.use(apiRateLimit);
sessionsRouter.use(requireAuth);

/**
 * POST /api/sessions
 * Start a new practice session.
 * Body: { type?: 'conversation' | 'interview' | 'drill', confidenceMode?: 'normal' | 'patient', interviewMeta?: {...} }
 * Returns: { sessionId, startedAt, type, confidenceMode }
 */
sessionsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = sessionStartSchema.parse(req.body);
    const userId = req.auth!.userId;

    const session = await PracticeSessionModel.create({
      userId,
      type: body.type ?? 'conversation',
      confidenceMode: body.confidenceMode ?? 'normal',
      nativeLanguage: req.auth!.nativeLanguage ?? 'en',
      interviewMeta: body.interviewMeta ?? null,
      status: 'active',
      startedAt: new Date(),
      totalUserSpeechMs: 0,
      turnCount: 0,
    });

    logger.info({ sessionId: session._id, userId, type: session.type }, 'Practice session started');

    res.status(201).json({
      sessionId: session._id,
      startedAt: session.startedAt,
      type: session.type,
      confidenceMode: session.confidenceMode,
    });
  }),
);

/**
 * PATCH /api/sessions/:id/turns
 * Add a turn to an active session.
 * Body: { transcript, coachResponse, evidence, audioHash }
 * Returns: { turn, metrics }
 */
sessionsRouter.patch(
  '/:id/turns',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = turnAddSchema.parse(req.body);
    const userId = req.auth!.userId;

    const session = await PracticeSessionModel.findOne({ _id: id, userId, status: 'active' });
    if (!session) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Active session not found' } });
    }

    // Compute metrics from evidence
    const sciResult = computeSCI(
      body.evidence.transcript,
      body.evidence.words,
      body.evidence.segments,
      body.evidence.audioDurationMs,
      session.nativeLanguage,
    );

    const metrics: TurnMetrics = {
      fluency: sciResult.components.fluency,
      paceConsistency: sciResult.components.continuity,
      accuracy: sciResult.components.accuracy,
      composure: sciResult.components.composure,
      sci: sciResult.sci,
      formulaVersion: SCI_FORMULA_VERSION,
      computedAt: new Date(),
    };

    const turn = await TurnModel.create({
      sessionId: session._id,
      turnIndex: session.turnCount,
      transcript: body.evidence.transcript,
      coachResponse: body.coachResponse,
      evidence: body.evidence,
      metrics,
      startedAt: new Date(Date.now() - body.evidence.audioDurationMs),
      endedAt: new Date(),
      audioHash: body.audioHash ?? null,
    });

    // Update session aggregates
    session.turnCount += 1;
    session.totalUserSpeechMs += body.evidence.audioDurationMs;
    await session.save();

    logger.info({ sessionId: session._id, turnIndex: turn.turnIndex, sci: metrics.sci }, 'Turn added');

    res.status(201).json({
      turn: {
        turnIndex: turn.turnIndex,
        transcript: turn.transcript,
        coachResponse: turn.coachResponse,
        metrics: turn.metrics,
        startedAt: turn.startedAt,
        endedAt: turn.endedAt,
      },
      metrics,
    });
  }),
);

/**
 * GET /api/sessions/:id/report
 * Generate a session report with evidence-based analysis.
 * Query: ?includeTurns=true
 * Returns: { session, summary, turns[], insights }
 */
sessionsRouter.get(
  '/:id/report',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.auth!.userId;
    const includeTurns = req.query.includeTurns === 'true';

    const session = await PracticeSessionModel.findOne({ _id: id, userId });
    if (!session) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Session not found' } });
    }

    const turns = includeTurns
      ? (await TurnModel.find({ sessionId: session._id }).sort({ turnIndex: 1 }).lean()) as LeanTurn[]
      : [];

    // If session is active, compute provisional summary
    let summary = session.summary;
    if (!summary && session.turnCount > 0) {
      const turnDocs = (await TurnModel.find({ sessionId: session._id }).sort({ turnIndex: 1 }).lean()) as LeanTurn[];
      summary = computeSessionSummary({
        turnMetrics: turnDocs.map((t) => ({
          sci: t.metrics?.sci ?? null,
          fluency: t.metrics?.fluency ?? null,
          accuracy: t.metrics?.accuracy ?? null,
          composure: t.metrics?.composure ?? null,
        })),
        totalUserSpeechMs: session.totalUserSpeechMs,
        turnCount: session.turnCount,
      });
    }

    // Generate insights
    const insights = generateInsights(session, turns);

    res.json({
      session: {
        id: session._id,
        type: session.type,
        status: session.status,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        totalUserSpeechMs: session.totalUserSpeechMs,
        turnCount: session.turnCount,
        confidenceMode: session.confidenceMode,
        nativeLanguage: session.nativeLanguage,
      },
      summary,
      turns: includeTurns
        ? turns.map((t) => ({
            turnIndex: t.turnIndex,
            transcript: t.transcript,
            coachResponse: t.coachResponse,
            metrics: t.metrics,
            evidence: t.evidence,
            startedAt: t.startedAt,
            endedAt: t.endedAt,
          }))
        : undefined,
      insights,
      formulaVersion: SCI_FORMULA_VERSION,
    });
  }),
);

/**
 * POST /api/sessions/:id/complete
 * Mark a session as completed and generate final summary.
 */
sessionsRouter.post(
  '/:id/complete',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.auth!.userId;

    const session = await PracticeSessionModel.findOne({ _id: id, userId, status: 'active' });
    if (!session) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Active session not found' } });
    }

    if (session.turnCount === 0) {
      session.status = 'abandoned';
      session.endedAt = new Date();
      await session.save();
      return res.json({ message: 'Session abandoned (no turns)', sessionId: session._id });
    }

    const turnDocs = (await TurnModel.find({ sessionId: session._id }).sort({ turnIndex: 1 }).lean()) as LeanTurn[];
    const summary = computeSessionSummary({
      turnMetrics: turnDocs.map((t) => ({
        sci: t.metrics?.sci ?? null,
        fluency: t.metrics?.fluency ?? null,
        accuracy: t.metrics?.accuracy ?? null,
        composure: t.metrics?.composure ?? null,
      })),
      totalUserSpeechMs: session.totalUserSpeechMs,
      turnCount: session.turnCount,
    });

    session.status = 'completed';
    session.endedAt = new Date();
    session.summary = summary;
    await session.save();

    logger.info({ sessionId: session._id, userId, avgSci: summary.avgSci }, 'Session completed');

    res.json({
      message: 'Session completed',
      sessionId: session._id,
      summary,
    });
  }),
);

/**
 * GET /api/sessions
 * List user's sessions (paginated).
 * Query: ?status=completed&limit=20&offset=0
 */
sessionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const status = req.query.status as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const filter: Record<string, unknown> = { userId };
    if (status) filter.status = status;

    const [sessions, total] = await Promise.all([
      PracticeSessionModel.find(filter)
        .sort({ startedAt: -1 })
        .skip(offset)
        .limit(limit)
        .select('type status startedAt endedAt totalUserSpeechMs turnCount summary confidenceMode')
        .lean(),
      PracticeSessionModel.countDocuments(filter),
    ]);

    res.json({
      sessions,
      pagination: { total, limit, offset },
    });
  }),
);

/** Validation schemas */
const sessionStartSchema = z.object({
  type: z.enum(['conversation', 'interview', 'drill']).optional(),
  confidenceMode: z.enum(['normal', 'patient']).optional(),
  interviewMeta: z
    .object({
      role: z.string().optional(),
      domain: z.string().optional(),
      interviewType: z.string().optional(),
      questionBankVersion: z.string().optional(),
    })
    .optional(),
});

const turnAddSchema = z.object({
  transcript: z.string().min(1).max(8000),
  coachResponse: z.string().min(1).max(8000),
  evidence: z.object({
    transcript: z.string().min(1),
    words: z.array(
      z.object({
        word: z.string(),
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().nonnegative(),
        confidence: z.number().nullable().optional(),
      })
    ),
    segments: z.array(
      z.object({
        text: z.string(),
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().nonnegative(),
        noSpeechProbability: z.number().nullable().optional(),
      })
    ),
    audioDurationMs: z.number().int().positive(),
    sttProviderId: z.string(),
  }),
  audioHash: z.string().optional(),
});

/**
 * Generate human-readable insights from a session.
 * Returns structured feedback with evidence references.
 */
function generateInsights(
  session: IPracticeSession,
  _turns: LeanTurn[]
): Array<{ type: string; message: string; evidence?: string; priority: 'high' | 'medium' | 'low' }> {
  const insights: Array<{ type: string; message: string; evidence?: string; priority: 'high' | 'medium' | 'low' }> = [];

  if (!session.summary || session.turnCount === 0) {
    insights.push({
      type: 'info',
      message: 'Not enough data yet — complete at least 3 turns for meaningful insights.',
      priority: 'low',
    });
    return insights;
  }

  const { avgSci, avgFluency, avgAccuracy, avgComposure, level } = session.summary;

  // Overall level
  if (level) {
    insights.push({
      type: 'level',
      message: `Your speaking level this session: ${level} (avg SCI: ${avgSci})`,
      priority: 'high',
    });
  }

  // Fluency insight
  if (avgFluency !== null && avgFluency < 60) {
    insights.push({
      type: 'fluency',
      message: 'Try to reduce silent pauses — aim for more continuous speech flow.',
      evidence: 'Fluency score based on speech-time vs total-turn-time ratio from word timestamps.',
      priority: 'high',
    });
  }

  // Accuracy insight
  if (avgAccuracy !== null && avgAccuracy < 60) {
    insights.push({
      type: 'accuracy',
      message: 'Focus on vocabulary variety and sentence structure. Try using more diverse words.',
      evidence: 'Accuracy score based on word count, sentence count, and STT confidence.',
      priority: 'high',
    });
  }

  // Composure insight
  if (avgComposure !== null && avgComposure < 60) {
    insights.push({
      type: 'composure',
      message: 'Reduce filler words (um, uh, like) and avoid repeating words. Take a breath before speaking.',
      evidence: 'Composure score based on filler count, word repetitions, and pause analysis.',
      priority: 'medium',
    });
  }

  // Turn count insight
  if (session.turnCount < 5) {
    insights.push({
      type: 'volume',
      message: `Only ${session.turnCount} turns this session. Longer sessions give more reliable trends.`,
      priority: 'low',
    });
  }

  // Speech time insight
  const speechMinutes = Math.round(session.totalUserSpeechMs / 60000);
  if (speechMinutes < 2) {
    insights.push({
      type: 'volume',
      message: `You spoke for ${speechMinutes} minute${speechMinutes !== 1 ? 's' : ''}. Try to speak longer each turn.`,
      priority: 'medium',
    });
  }

  return insights;
}