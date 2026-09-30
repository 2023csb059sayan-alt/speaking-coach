import mongoose, { type Document, type Model, Schema } from 'mongoose';

/**
 * Interview question bank — cached static questions.
 *
 * Questions are versioned so we can update the bank without breaking existing sessions.
 * Audio for questions is pre-generated and stored by hash (TTS caching).
 */

export type InterviewCategory =
  | 'hr'
  | 'behavioral'
  | 'technical'
  | 'situational'
  | 'campus'
  | 'panel'
  | 'stress'
  | 'full_mock';

export type InterviewDifficulty = 'easy' | 'medium' | 'hard';

export interface IInterviewQuestion extends Document {
  /** Stable identifier for the question */
  questionId: string;
  /** Human-readable category */
  category: InterviewCategory;
  /** Difficulty level */
  difficulty: InterviewDifficulty;
  /** The question text */
  text: string;
  /** Expected key points for a strong answer (for evaluation) */
  keyPoints: string[];
  /** Follow-up question templates (filled with user's facts) */
  followUps: string[];
  /** Tags for filtering (e.g., 'leadership', 'conflict', 'debugging') */
  tags: string[];
  /** Bank version this question belongs to */
  bankVersion: string;
  /** Audio hash for pre-generated TTS (if available) */
  audioHash?: string;
  /** Estimated time to answer well (seconds) */
  estimatedDurationSec: number;
  /** Whether this question requires specific domain knowledge */
  domainSpecific: boolean;
  /** Created/updated timestamps */
  createdAt: Date;
  updatedAt: Date;
}

const InterviewQuestionSchema = new Schema<IInterviewQuestion>({
  questionId: { type: String, required: true, unique: true, index: true },
  category: {
    type: String,
    enum: ['hr', 'behavioral', 'technical', 'situational', 'campus', 'panel', 'stress', 'full_mock'],
    required: true,
    index: true,
  },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'], required: true },
  text: { type: String, required: true, maxlength: 500 },
  keyPoints: [{ type: String, maxlength: 200 }],
  followUps: [{ type: String, maxlength: 300 }],
  tags: [{ type: String, maxlength: 50 }],
  bankVersion: { type: String, required: true, index: true },
  audioHash: { type: String, default: null },
  estimatedDurationSec: { type: Number, default: 120, min: 30, max: 600 },
  domainSpecific: { type: Boolean, default: false },
}, { timestamps: true });

InterviewQuestionSchema.index({ category: 1, difficulty: 1, bankVersion: 1 });

export const InterviewQuestionModel: Model<IInterviewQuestion> = mongoose.model<IInterviewQuestion>('InterviewQuestion', InterviewQuestionSchema);

/**
 * Interview session metadata (extends PracticeSession).
 */
export interface IInterviewSessionMeta {
  /** Role being interviewed for (e.g., 'Software Engineer', 'Product Manager') */
  role: string;
  /** Domain/industry (e.g., 'FinTech', 'E-commerce', 'Healthcare') */
  domain: string;
  /** Interview type(s) included */
  interviewTypes: InterviewCategory[];
  /** Question bank version used */
  questionBankVersion: string;
  /** Total questions planned */
  plannedQuestionCount: number;
  /** Questions asked so far */
  askedQuestionCount: number;
  /** Current question index */
  currentQuestionIndex: number;
  /** Mode: 'practice' (retry allowed) | 'exam' (timed, no retry) */
  mode: 'practice' | 'exam';
  /** Time limit per question (seconds) — exam mode only */
  timeLimitPerQuestionSec?: number;
  /** JD/Resume reference IDs (encrypted, minimal retention) */
  jdRefId?: string;
  resumeRefId?: string;
  /** Readiness score (0-100, null if not enough data) */
  readinessScore: number | null;
  /** Readiness formula version */
  readinessFormulaVersion: string;
  /** Whether the interview is complete */
  isComplete: boolean;
  /** When the interview was started */
  startedAt: Date;
  /** When the interview was completed */
  completedAt: Date | null;
}

/**
 * JD/Resume storage — minimal retention, encrypted, deletable.
 *
 * These are stored separately from the session so they can be deleted independently.
 * Content is encrypted at rest using the key vault.
 */

export interface IInterviewDocument extends Document {
  userId: mongoose.Types.ObjectId;
  /** Type of document */
  docType: 'jd' | 'resume';
  /** Encrypted content (AES-256-GCM via keyVault) */
  encryptedContent: string;
  /** Original filename */
  filename: string;
  /** MIME type */
  mimeType: string;
  /** Size in bytes */
  size: number;
  /** When this document expires (auto-delete) */
  expiresAt: Date;
  /** Whether the user has explicitly deleted it */
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const InterviewDocumentSchema = new Schema<IInterviewDocument>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  docType: { type: String, enum: ['jd', 'resume'], required: true },
  encryptedContent: { type: String, required: true },
  filename: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  expiresAt: { type: Date, required: true, index: true },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

InterviewDocumentSchema.index({ userId: 1, docType: 1, deletedAt: 1 });

export const InterviewDocumentModel: Model<IInterviewDocument> = mongoose.model<IInterviewDocument>('InterviewDocument', InterviewDocumentSchema);

/**
 * Interview answer — stored per question for evaluation.
 */
export interface IInterviewAnswer extends Document {
  sessionId: mongoose.Types.ObjectId;
  questionId: string;
  questionIndex: number;
  /** User's transcript */
  transcript: string;
  /** Coach's evaluation feedback */
  evaluation?: {
    score: number; // 0-100
    strengths: string[];
    gaps: string[];
    strongerSample: string; // rewritten using user's own facts
    evidence: string; // what part of transcript supports this
  };
  /** STAR structure detected (for behavioral) */
  starStructure?: {
    situation: boolean;
    task: boolean;
    action: boolean;
    result: boolean;
  };
  /** Time taken to answer (ms) */
  timeTakenMs: number;
  /** Whether this was a retry (practice mode) */
  isRetry: boolean;
  /** Attempt number (1 = first, 2+ = retries) */
  attemptNumber: number;
  createdAt: Date;
}

const InterviewAnswerSchema = new Schema<IInterviewAnswer>({
  sessionId: { type: Schema.Types.ObjectId, ref: 'PracticeSession', required: true, index: true },
  questionId: { type: String, required: true },
  questionIndex: { type: Number, required: true },
  transcript: { type: String, required: true },
  evaluation: {
    score: { type: Number, min: 0, max: 100 },
    strengths: [String],
    gaps: [String],
    strongerSample: String,
    evidence: String,
  },
  starStructure: {
    situation: Boolean,
    task: Boolean,
    action: Boolean,
    result: Boolean,
  },
  timeTakenMs: { type: Number, required: true },
  isRetry: { type: Boolean, default: false },
  attemptNumber: { type: Number, default: 1 },
}, { timestamps: true });

InterviewAnswerSchema.index({ sessionId: 1, questionIndex: 1, attemptNumber: 1 }, { unique: true });

export const InterviewAnswerModel: Model<IInterviewAnswer> = mongoose.model<IInterviewAnswer>('InterviewAnswer', InterviewAnswerSchema);