import mongoose, { type Document, type Model, Schema } from 'mongoose';

/**
 * A single turn in a practice session.
 *
 * Every metric score links to stored evidence (the transcript, audio duration,
 * timestamps, etc.) so the learner can see exactly what was measured.
 * No score is ever shown without evidence.
 */

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
  confidence?: number | null;
}

export interface SegmentTiming {
  text: string;
  startMs: number;
  endMs: number;
  noSpeechProbability?: number | null;
}

export interface TurnEvidence {
  /** The STT transcript for this turn */
  transcript: string;
  /** Word-level timestamps from STT (when available) */
  words: WordTiming[];
  /** Segment-level timestamps from STT */
  segments: SegmentTiming[];
  /** Audio duration in milliseconds */
  audioDurationMs: number;
  /** Provider that produced this transcript */
  sttProviderId: string;
}

export interface TurnMetrics {
  /** 0–100: how much of the turn was actual speech vs silence */
  fluency: number | null;
  /** 0–100: pace consistency (words per minute stability) */
  paceConsistency: number | null;
  /** 0–100: coverage of expected vocabulary/grammar for the level */
  accuracy: number | null;
  /** 0–100: composure (fewer hesitations, fillers, restarts) */
  composure: number | null;
  /** 0–100: overall speaking confidence indicator (SCI) for this turn */
  sci: number | null;
  /** Formula version used to compute SCI */
  formulaVersion: string;
  /** Computed at */
  computedAt: Date;
}

export interface ITurn extends Document {
  sessionId: mongoose.Types.ObjectId;
  turnIndex: number;
  /** User's spoken transcript */
  transcript: string;
  /** Coach's response text */
  coachResponse: string;
  /** Evidence from STT + audio */
  evidence: TurnEvidence;
  /** Computed metrics (filled after turn ends) */
  metrics: TurnMetrics | null;
  /** When this turn started */
  startedAt: Date;
  /** When this turn ended (audio stopped) */
  endedAt: Date;
  /** Audio blob hash for caching TTS */
  audioHash?: string;
}

const WordTimingSchema = new Schema<WordTiming>({
  word: { type: String, required: true },
  startMs: { type: Number, required: true },
  endMs: { type: Number, required: true },
  confidence: { type: Number, default: null },
}, { _id: false });

const SegmentTimingSchema = new Schema<SegmentTiming>({
  text: { type: String, required: true },
  startMs: { type: Number, required: true },
  endMs: { type: Number, required: true },
  noSpeechProbability: { type: Number, default: null },
}, { _id: false });

const TurnEvidenceSchema = new Schema<TurnEvidence>({
  transcript: { type: String, required: true },
  words: [WordTimingSchema],
  segments: [SegmentTimingSchema],
  audioDurationMs: { type: Number, required: true },
  sttProviderId: { type: String, required: true },
}, { _id: false });

const TurnMetricsSchema = new Schema<TurnMetrics>({
  fluency: { type: Number, min: 0, max: 100, default: null },
  paceConsistency: { type: Number, min: 0, max: 100, default: null },
  accuracy: { type: Number, min: 0, max: 100, default: null },
  composure: { type: Number, min: 0, max: 100, default: null },
  sci: { type: Number, min: 0, max: 100, default: null },
  formulaVersion: { type: String, default: 'SCI-v1.0.0' },
  computedAt: { type: Date, default: Date.now },
}, { _id: false });

const TurnSchema = new Schema<ITurn>({
  sessionId: { type: Schema.Types.ObjectId, ref: 'PracticeSession', required: true, index: true },
  turnIndex: { type: Number, required: true },
  transcript: { type: String, required: true },
  coachResponse: { type: String, required: true },
  evidence: { type: TurnEvidenceSchema, required: true },
  metrics: { type: TurnMetricsSchema, default: null },
  startedAt: { type: Date, required: true, default: Date.now },
  endedAt: { type: Date, required: true, default: Date.now },
  audioHash: { type: String, default: null },
}, { timestamps: true });

TurnSchema.index({ sessionId: 1, turnIndex: 1 }, { unique: true });

export const TurnModel: Model<ITurn> = mongoose.model<ITurn>('Turn', TurnSchema);

/**
 * A practice session (one continuous conversation with the coach).
 *
 * Sessions aggregate turns and produce a session-level report when the learner
 * ends the session or after a minimum number of turns.
 */

export interface SessionSummary {
  totalTurns: number;
  totalUserSpeechMs: number;
  avgSci: number | null;
  avgFluency: number | null;
  avgAccuracy: number | null;
  avgComposure: number | null;
  level?: string;
  formulaVersion: string;
  generatedAt: Date;
}

export interface IPracticeSession extends Document {
  userId: mongoose.Types.ObjectId;
  /** Session type: 'conversation' | 'interview' | 'drill' */
  type: 'conversation' | 'interview' | 'drill';
  /** Current status */
  status: 'active' | 'completed' | 'abandoned';
  /** When the session started */
  startedAt: Date;
  /** When the session ended (if completed) */
  endedAt: Date | null;
  /** Total user speech time in milliseconds */
  totalUserSpeechMs: number;
  /** Number of turns */
  turnCount: number;
  /** Session-level summary metrics (filled on completion) */
  summary: SessionSummary | null;
  /** Interview-specific metadata (when type === 'interview') */
  interviewMeta?: {
    role: string;
    domain: string;
    interviewType: string;
    questionBankVersion: string;
  };
  /** Confidence mode used */
  confidenceMode: 'normal' | 'patient';
  /** Native language of the learner */
  nativeLanguage: string;
}

const SessionSummarySchema = new Schema<SessionSummary>({
  totalTurns: { type: Number, required: true },
  totalUserSpeechMs: { type: Number, required: true },
  avgSci: { type: Number, min: 0, max: 100, default: null },
  avgFluency: { type: Number, min: 0, max: 100, default: null },
  avgAccuracy: { type: Number, min: 0, max: 100, default: null },
  avgComposure: { type: Number, min: 0, max: 100, default: null },
  level: { type: String, default: null },
  formulaVersion: { type: String, default: 'SCI-v1.0.0' },
  generatedAt: { type: Date, default: Date.now },
}, { _id: false });

const PracticeSessionSchema = new Schema<IPracticeSession>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['conversation', 'interview', 'drill'], default: 'conversation' },
  status: { type: String, enum: ['active', 'completed', 'abandoned'], default: 'active' },
  startedAt: { type: Date, required: true, default: Date.now },
  endedAt: { type: Date, default: null },
  totalUserSpeechMs: { type: Number, default: 0 },
  turnCount: { type: Number, default: 0 },
  summary: { type: SessionSummarySchema, default: null },
  interviewMeta: { type: Schema.Types.Mixed, default: null },
  confidenceMode: { type: String, enum: ['normal', 'patient'], default: 'normal' },
  nativeLanguage: { type: String, default: 'en' },
}, { timestamps: true });

PracticeSessionSchema.index({ userId: 1, status: 1, startedAt: -1 });

export const PracticeSessionModel: Model<IPracticeSession> = mongoose.model<IPracticeSession>('PracticeSession', PracticeSessionSchema);