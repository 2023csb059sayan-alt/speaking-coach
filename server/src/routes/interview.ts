import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { apiRateLimit } from '../middleware/security';
import { requireAuth, requireClientHeader } from '../middleware/auth';
import {
  InterviewQuestionModel,
  InterviewDocumentModel,
  InterviewAnswerModel,
  type IInterviewQuestion,
  type InterviewCategory,
} from '../models';
import { PracticeSessionModel } from '../models';
import { encryptSecret } from '../services/keyVault';
import { logger } from '../logging';

/** Lean document shape for interview questions (avoids FlattenMaps issues) */
interface LeanInterviewQuestion {
  questionId: string;
  category: InterviewCategory;
  difficulty: 'easy' | 'medium' | 'hard';
  text: string;
  keyPoints: string[];
  followUps: string[];
  tags: string[];
  bankVersion: string;
  audioHash?: string;
  estimatedDurationSec: number;
  domainSpecific: boolean;
}

/** Lean interview session metadata shape */
interface LeanInterviewMeta {
  role: string;
  domain: string;
  interviewTypes: InterviewCategory[];
  questionBankVersion: string;
  plannedQuestionCount: number;
  askedQuestionCount: number;
  currentQuestionIndex: number;
  mode: 'practice' | 'exam';
  timeLimitPerQuestionSec?: number;
  jdRefId?: string;
  resumeRefId?: string;
  readinessScore: number | null;
  readinessFormulaVersion: string;
  isComplete: boolean;
  startedAt: Date;
  completedAt: Date | null;
}

/**
 * Interview routes: question bank, JD/resume upload, interview session flow.
 *
 * All routes require authentication (httpOnly cookie) and the x-sc-client header.
 */

export const interviewRouter = Router();

interviewRouter.use(requireClientHeader);
interviewRouter.use(apiRateLimit);
interviewRouter.use(requireAuth);

/**
 * GET /api/interview/questions
 * List questions with optional filters.
 * Query: category, difficulty, tags, limit, offset
 */
interviewRouter.get(
  '/questions',
  asyncHandler(async (req, res) => {
    const category = req.query.category as InterviewCategory | undefined;
    const difficulty = req.query.difficulty as 'easy' | 'medium' | 'hard' | undefined;
    const tags = req.query.tags ? (req.query.tags as string).split(',') : undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    // Get the latest bank version
    const latestVersion = await InterviewQuestionModel.findOne()
      .sort({ bankVersion: -1 })
      .select('bankVersion')
      .lean();

    if (!latestVersion) {
      return res.json({ questions: [], pagination: { total: 0, limit, offset }, bankVersion: null });
    }

    const filter: Record<string, unknown> = { bankVersion: latestVersion.bankVersion };
    if (category) filter.category = category;
    if (difficulty) filter.difficulty = difficulty;
    if (tags?.length) filter.tags = { $in: tags };

    const [questions, total] = await Promise.all([
      InterviewQuestionModel.find(filter)
        .sort({ category: 1, difficulty: 1, questionId: 1 })
        .skip(offset)
        .limit(limit)
        .select('-__v')
        .lean(),
      InterviewQuestionModel.countDocuments(filter),
    ]);

    res.json({
      questions,
      pagination: { total, limit, offset },
      bankVersion: latestVersion.bankVersion,
    });
  }),
);

/**
 * GET /api/interview/questions/:id
 * Get a single question with all details.
 */
interviewRouter.get(
  '/questions/:id',
  asyncHandler(async (req, res) => {
    const question = await InterviewQuestionModel.findOne({ questionId: req.params.id }).lean();
    if (!question) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Question not found' } });
    }
    res.json({ question });
  }),
);

/**
 * POST /api/interview/documents
 * Upload JD or resume (encrypted at rest, minimal retention).
 * Body: multipart/form-data with file, docType ('jd' | 'resume')
 * Returns: { documentId, expiresAt }
 */
interviewRouter.post(
  '/documents',
  asyncHandler(async (req, res) => {
    // For simplicity, we accept JSON with base64 content
    // In production, use multer for file upload
    const body = documentUploadSchema.parse(req.body);
    const userId = req.auth!.userId;

    const encrypted = await encryptSecret(body.content);

    // Auto-expire in 30 days unless user explicitly keeps it
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const doc = await InterviewDocumentModel.create({
      userId,
      docType: body.docType,
      encryptedContent: encrypted,
      filename: body.filename,
      mimeType: body.mimeType,
      size: body.content.length,
      expiresAt,
    });

    logger.info({ userId, docId: doc._id, docType: body.docType }, 'Interview document uploaded');

    res.status(201).json({
      documentId: doc._id,
      expiresAt: doc.expiresAt,
      message: 'Document stored encrypted. Auto-expires in 30 days. You can delete it anytime.',
    });
  }),
);

/**
 * DELETE /api/interview/documents/:id
 * Delete a JD/resume document.
 */
interviewRouter.delete(
  '/documents/:id',
  asyncHandler(async (req, res) => {
    const _userId = req.auth!.userId;
    const doc = await InterviewDocumentModel.findOneAndUpdate(
      { _id: req.params.id, userId: _userId },
      { deletedAt: new Date() },
      { new: true },
    );
    if (!doc) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Document not found' } });
    }
    logger.info({ userId: _userId, docId: doc._id }, 'Interview document deleted');
    res.json({ message: 'Document deleted' });
  }),
);

/**
 * GET /api/interview/documents
 * List user's documents.
 */
interviewRouter.get(
  '/documents',
  asyncHandler(async (req, res) => {
    const _userId = req.auth!.userId;
    const docs = await InterviewDocumentModel.find({ userId: _userId, deletedAt: null })
      .sort({ createdAt: -1 })
      .select('docType filename mimeType size expiresAt createdAt')
      .lean();
    res.json({ documents: docs });
  }),
);

/**
 * POST /api/interview/sessions
 * Start an interview session.
 * Body: { role, domain, interviewTypes[], mode, timeLimitPerQuestionSec?, jdRefId?, resumeRefId? }
 * Returns: { sessionId, questions[] }
 */
interviewRouter.post(
  '/sessions',
  asyncHandler(async (req, res) => {
    const body = interviewStartSchema.parse(req.body);
    const _userId = req.auth!.userId;

    // Validate JD/resume references if provided
    if (body.jdRefId) {
      const jd = await InterviewDocumentModel.findOne({ _id: body.jdRefId, userId: _userId, deletedAt: null });
      if (!jd) return res.status(400).json({ error: { code: 'bad_request', message: 'Invalid JD reference' } });
    }
    if (body.resumeRefId) {
      const resume = await InterviewDocumentModel.findOne({ _id: body.resumeRefId, userId: _userId, deletedAt: null });
      if (!resume) return res.status(400).json({ error: { code: 'bad_request', message: 'Invalid resume reference' } });
    }

    // Select questions based on interview types
    const latestVersion = await InterviewQuestionModel.findOne()
      .sort({ bankVersion: -1 })
      .select('bankVersion')
      .lean();

    if (!latestVersion) {
      return res.status(503).json({ error: { code: 'no_questions', message: 'Question bank not available' } });
    }

    // For each interview type, select questions
    const questionsByType: Record<string, IInterviewQuestion[]> = {};
    let totalPlanned = 0;

    for (const type of body.interviewTypes) {
      const questions = await InterviewQuestionModel.find({
        bankVersion: latestVersion.bankVersion,
        category: type,
        difficulty: body.mode === 'exam' ? 'medium' : { $in: ['easy', 'medium'] },
      })
        .sort({ difficulty: 1, questionId: 1 })
        .limit(body.mode === 'exam' ? 5 : 10)
        .lean();

      questionsByType[type] = questions as unknown as IInterviewQuestion[];
      totalPlanned += questions.length;
    }

    // Create practice session with interview metadata
    const session = await PracticeSessionModel.create({
      userId: _userId,
      type: 'interview',
      status: 'active',
      startedAt: new Date(),
      totalUserSpeechMs: 0,
      turnCount: 0,
      confidenceMode: 'normal',
      nativeLanguage: req.auth!.nativeLanguage ?? 'en',
      interviewMeta: {
        role: body.role,
        domain: body.domain,
        interviewTypes: body.interviewTypes,
        questionBankVersion: latestVersion.bankVersion,
        plannedQuestionCount: totalPlanned,
        askedQuestionCount: 0,
        currentQuestionIndex: 0,
        mode: body.mode,
        timeLimitPerQuestionSec: body.timeLimitPerQuestionSec,
        jdRefId: body.jdRefId,
        resumeRefId: body.resumeRefId,
        readinessScore: null,
        readinessFormulaVersion: 'IRS-v1.0.0',
        isComplete: false,
      },
    });

    // Flatten questions in order
    const allQuestions: IInterviewQuestion[] = [];
    for (const type of body.interviewTypes) {
      allQuestions.push(...(questionsByType[type] || []));
    }

    logger.info(
      { sessionId: session._id, userId: _userId, types: body.interviewTypes, questionCount: allQuestions.length },
      'Interview session started',
    );

    res.status(201).json({
      sessionId: session._id,
      questions: allQuestions.map((q) => ({
        questionId: q.questionId,
        category: q.category,
        difficulty: q.difficulty,
        text: q.text,
        estimatedDurationSec: q.estimatedDurationSec,
      })),
      meta: {
        role: body.role,
        domain: body.domain,
        mode: body.mode,
        totalQuestions: allQuestions.length,
      },
    });
  }),
);

/**
 * GET /api/interview/sessions/:id/question/:index
 * Get the current question for an interview session.
 */
interviewRouter.get(
  '/sessions/:id/question/:index',
  asyncHandler(async (req, res) => {
    const _userId = req.auth!.userId;
    const sessionId = req.params.id!;
    const index = parseInt(req.params.index ?? '0', 10);

    const session = await PracticeSessionModel.findOne({ _id: sessionId, userId: _userId, type: 'interview' });
    if (!session) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Interview session not found' } });
    }

    const meta = session.interviewMeta as LeanInterviewMeta;
    if (!meta) {
      return res.status(400).json({ error: { code: 'bad_request', message: 'Not an interview session' } });
    }

    if (index >= meta.plannedQuestionCount) {
      return res.status(400).json({ error: { code: 'bad_request', message: 'Question index out of bounds' } });
    }

    // Get the question (we need to fetch from the bank)
    const questionDoc = await InterviewQuestionModel.findOne({
      bankVersion: meta.questionBankVersion,
      // In practice, we'd track which questions were selected. For now, re-query.
    }).select('questionId category difficulty text keyPoints followUps tags bankVersion audioHash estimatedDurationSec domainSpecific').lean().exec();

    const question = questionDoc
      ? JSON.parse(JSON.stringify(questionDoc)) as LeanInterviewQuestion
      : null;

    // For simplicity, we'll just return a placeholder
    // Real implementation would store selected question IDs in session meta
    res.json({
      question: {
        questionId: question?.questionId ?? 'placeholder',
        text: question?.text ?? 'This would be the actual question from the bank',
        category: meta.interviewTypes[index % meta.interviewTypes.length],
        estimatedDurationSec: 120,
      },
      index,
      total: meta.plannedQuestionCount,
      mode: meta.mode,
      timeLimitPerQuestionSec: meta.timeLimitPerQuestionSec,
    });
  }),
);

/**
 * POST /api/interview/sessions/:id/answer
 * Submit an answer for the current question.
 * Body: { questionId, transcript, timeTakenMs, isRetry }
 * Returns: { evaluation, nextQuestionIndex }
 */
interviewRouter.post(
  '/sessions/:id/answer',
  asyncHandler(async (req, res) => {
    const body = answerSubmitSchema.parse(req.body);
    const userId = req.auth!.userId;
    const sessionId = req.params.id!;

    const session = await PracticeSessionModel.findOne({ _id: sessionId, userId, type: 'interview', status: 'active' });
    if (!session) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Active interview session not found' } });
    }

    if (!session.interviewMeta) {
      return res.status(400).json({ error: { code: 'bad_request', message: 'Not an interview session' } });
    }
    const meta = session.interviewMeta;
    if (meta.isComplete) {
      return res.status(400).json({ error: { code: 'bad_request', message: 'Interview already complete' } });
    }

    // Check if this is a retry
    const existingAnswer = await InterviewAnswerModel.findOne({
      sessionId,
      questionId: body.questionId,
      attemptNumber: body.isRetry ? { $gte: 1 } : 1,
    }).sort({ attemptNumber: -1 }).lean();

    const attemptNumber = body.isRetry && existingAnswer ? existingAnswer.attemptNumber + 1 : 1;

    // In exam mode, retries are not allowed
    if (meta.mode === 'exam' && body.isRetry) {
      return res.status(400).json({ error: { code: 'bad_request', message: 'Retries not allowed in exam mode' } });
    }

    // For now, create a placeholder evaluation
    // Real implementation would use LLM to evaluate against key points
    const evaluation = {
      score: 75, // placeholder
      strengths: ['Clear communication', 'Relevant example'],
      gaps: ['Could quantify results more', 'Missing STAR structure for behavioral'],
      strongerSample: 'Here is a stronger version using your facts...',
      evidence: 'Based on your mention of leading a team of 5...',
    };

    const answer = await InterviewAnswerModel.create({
      sessionId,
      questionId: body.questionId,
      questionIndex: meta.currentQuestionIndex,
      transcript: body.transcript,
      evaluation,
      timeTakenMs: body.timeTakenMs,
      isRetry: body.isRetry,
      attemptNumber,
    });

    // Update session
    session.turnCount += 1;
    session.totalUserSpeechMs += body.timeTakenMs;
    session.interviewMeta!.askedQuestionCount += 1;
    session.interviewMeta!.currentQuestionIndex += 1;

    // Check if interview is complete
    if (session.interviewMeta!.currentQuestionIndex >= meta.plannedQuestionCount) {
      meta.isComplete = true;
      meta.completedAt = new Date();
      session.status = 'completed';
      session.endedAt = new Date();
      // Compute readiness score
      meta.readinessScore = await computeReadinessScore(sessionId);
    }

    await session.save();

    const nextIndex = session.interviewMeta!.currentQuestionIndex;
    const hasNext = nextIndex < meta.plannedQuestionCount;

    res.json({
      answer: {
        questionId: answer.questionId,
        score: evaluation.score,
        strengths: evaluation.strengths,
        gaps: evaluation.gaps,
        strongerSample: evaluation.strongerSample,
        evidence: evaluation.evidence,
      },
      nextQuestionIndex: hasNext ? nextIndex : null,
      isComplete: !hasNext,
    });
  }),
);

/**
 * GET /api/interview/sessions/:id/report
 * Get the post-interview report with "what you said → why it fell short → stronger sample → re-answer".
 */
interviewRouter.get(
  '/sessions/:id/report',
  asyncHandler(async (req, res) => {
    const _userId = req.auth!.userId;
    const sessionId = req.params.id!;

    const session = await PracticeSessionModel.findOne({ _id: sessionId, userId: _userId, type: 'interview' });
    if (!session) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Interview session not found' } });
    }

    if (!session.interviewMeta) {
      return res.status(400).json({ error: { code: 'bad_request', message: 'Not an interview session' } });
    }

    const meta = session.interviewMeta;

    const answers = await InterviewAnswerModel.find({ sessionId })
      .sort({ questionIndex: 1, attemptNumber: 1 })
      .lean();

    // Build detailed report
    const questionReports = answers.map((ans) => ({
      questionId: ans.questionId,
      questionIndex: ans.questionIndex,
      transcript: ans.transcript,
      evaluation: ans.evaluation,
      starStructure: ans.starStructure,
      timeTakenMs: ans.timeTakenMs,
      attemptNumber: ans.attemptNumber,
    }));

    // Overall readiness
    const readinessScore: number | null = meta.readinessScore ?? await computeReadinessScore(sessionId);

    res.json({
      session: {
        id: session._id,
        role: meta.role,
        domain: meta.domain,
        mode: meta.mode,
        startedAt: session.startedAt,
        completedAt: meta.completedAt,
        totalQuestions: meta.plannedQuestionCount,
        answeredQuestions: meta.askedQuestionCount,
      },
      readiness: {
        score: readinessScore,
        formulaVersion: 'IRS-v1.0.0',
        interpretation: readinessScore === null
          ? 'Not enough data yet — complete at least 5 scored answers for a readiness score.'
          : readinessScore >= 80
            ? 'Strong readiness — well prepared for this interview type.'
            : readinessScore >= 60
              ? 'Moderate readiness — focus on the gaps identified below.'
              : 'Needs improvement — review the detailed feedback for each question.',
      },
      questions: questionReports,
      summary: {
        totalScore: questionReports.length
          ? Math.round(questionReports.reduce((acc: number, q: typeof questionReports[0]) => acc + (q.evaluation?.score ?? 0), 0) / questionReports.length)
          : 0,
        starCompleteness: questionReports.filter((q: typeof questionReports[0]) => q.starStructure?.situation && q.starStructure?.task && q.starStructure?.action && q.starStructure?.result).length,
        avgTimeTakenMs: questionReports.length
          ? Math.round(questionReports.reduce((acc: number, q: typeof questionReports[0]) => acc + q.timeTakenMs, 0) / questionReports.length)
          : 0,
      },
    });
  }),
);

/**
 * GET /api/interview/sessions
 * List user's interview sessions.
 */
interviewRouter.get(
  '/sessions',
  asyncHandler(async (req, res) => {
    const _userId = req.auth!.userId;
    const status = req.query.status as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const filter: Record<string, unknown> = { userId: _userId, type: 'interview' };
    if (status) filter.status = status;

    const [sessions, total] = await Promise.all([
      PracticeSessionModel.find(filter)
        .sort({ startedAt: -1 })
        .skip(offset)
        .limit(limit)
        .select('interviewMeta status startedAt endedAt turnCount totalUserSpeechMs interviewMeta.readinessScore')
        .lean(),
      PracticeSessionModel.countDocuments(filter),
    ]);

    res.json({
      sessions: sessions.map((s) => ({
        id: s._id,
        status: s.status,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        turnCount: s.turnCount,
        totalUserSpeechMs: s.totalUserSpeechMs,
        readinessScore: (s.interviewMeta as LeanInterviewMeta | null)?.readinessScore,
        role: (s.interviewMeta as LeanInterviewMeta | null)?.role,
        domain: (s.interviewMeta as LeanInterviewMeta | null)?.domain,
        mode: (s.interviewMeta as LeanInterviewMeta | null)?.mode,
      })),
      pagination: { total, limit, offset },
    });
  }),
);

/** Validation schemas */
const documentUploadSchema = z.object({
  docType: z.enum(['jd', 'resume']),
  content: z.string().min(1).max(50000), // base64 or plain text
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
});

const interviewStartSchema = z.object({
  role: z.string().min(1).max(100),
  domain: z.string().min(1).max(100),
  interviewTypes: z.array(z.enum(['hr', 'behavioral', 'technical', 'situational', 'campus', 'panel', 'stress', 'full_mock'])).min(1).max(8),
  mode: z.enum(['practice', 'exam']).default('practice'),
  timeLimitPerQuestionSec: z.number().int().positive().max(600).optional(),
  jdRefId: z.string().optional(),
  resumeRefId: z.string().optional(),
});

const answerSubmitSchema = z.object({
  questionId: z.string().min(1),
  transcript: z.string().min(1).max(8000),
  timeTakenMs: z.number().int().positive(),
  isRetry: z.boolean().default(false),
});

/**
 * Compute Interview Readiness Score (IRS-v1.0.0).
 *
 * Formula: 0.50 * answer_score + 0.30 * star_ratio + 0.20 * delivery
 * Requires ≥5 scored answers.
 * - answer_score: average of evaluation scores (0-100)
 * - star_ratio: proportion of behavioral questions with full STAR structure
 * - delivery: average of fluency/composure from session metrics
 */
async function computeReadinessScore(sessionId: string): Promise<number | null> {
  const answers = await InterviewAnswerModel.find({ sessionId }).lean();
  const scored = answers.filter((a) => a.evaluation && typeof a.evaluation.score === 'number');

  if (scored.length < 5) return null;

  const answerScore = scored.reduce((s, a) => s + (a.evaluation?.score ?? 0), 0) / scored.length;

  const behavioralAnswers = scored.filter((a) => a.starStructure);
  const starComplete = behavioralAnswers.filter(
    (a) => a.starStructure?.situation && a.starStructure?.task && a.starStructure?.action && a.starStructure?.result,
  ).length;
  const starRatio = behavioralAnswers.length > 0 ? starComplete / behavioralAnswers.length : 1;

  // Delivery would come from session metrics; simplified here
  const delivery = 75; // placeholder

  const score = Math.round(0.50 * answerScore + 0.30 * starRatio * 100 + 0.20 * delivery);
  return Math.min(100, Math.max(0, score));
}