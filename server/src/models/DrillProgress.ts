import mongoose, { type Document, type Model, Schema } from 'mongoose';

/**
 * Vocabulary item for spaced repetition (SM-2 algorithm).
 *
 * Each learner has their own vocabulary deck with individual scheduling.
 * Cards are reviewed and graded 0-5 (SM-2 scale).
 */

export interface IVocabularyCard extends Document {
  userId: mongoose.Types.ObjectId;
  /** The word or phrase */
  term: string;
  /** Definition in English */
  definition: string;
  /** Example sentence */
  example?: string;
  /** IPA pronunciation */
  ipa?: string;
  /** Audio hash for TTS caching */
  audioHash?: string;
  /** Tags for filtering (e.g., 'business', 'interview', 'idiom') */
  tags: string[];
  /** Source of the word (e.g., 'interview_feedback', 'drill', 'manual') */
  source: string;
  /** Reference ID if from interview/session */
  sourceRefId?: string;
  /** SM-2 scheduling fields */
  easinessFactor: number;        // EF, starts at 2.5
  intervalDays: number;          // current interval in days
  repetitions: number;           // successful reviews in a row
  nextReviewAt: Date;            // when this card is due
  lastReviewedAt: Date | null;
  /** Total review count */
  reviewCount: number;
  /** Lapse count (times graded < 3) */
  lapseCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const VocabularyCardSchema = new Schema<IVocabularyCard>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  term: { type: String, required: true, maxlength: 100, trim: true },
  definition: { type: String, required: true, maxlength: 500 },
  example: { type: String, maxlength: 500 },
  ipa: { type: String, maxlength: 100 },
  audioHash: { type: String },
  tags: [{ type: String, maxlength: 50 }],
  source: { type: String, required: true, maxlength: 50 },
  sourceRefId: { type: String },
  easinessFactor: { type: Number, default: 2.5, min: 1.3 },
  intervalDays: { type: Number, default: 0, min: 0 },
  repetitions: { type: Number, default: 0, min: 0 },
  nextReviewAt: { type: Date, required: true, default: Date.now, index: true },
  lastReviewedAt: { type: Date, default: null },
  reviewCount: { type: Number, default: 0, min: 0 },
  lapseCount: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

VocabularyCardSchema.index({ userId: 1, nextReviewAt: 1 });
VocabularyCardSchema.index({ userId: 1, term: 1 }, { unique: true });

export const VocabularyCardModel: Model<IVocabularyCard> = mongoose.model<IVocabularyCard>('VocabularyCard', VocabularyCardSchema);

/**
 * Drill session — a focused practice on a specific skill.
 */
export type DrillType =
  | 'pronunciation'      // minimal pairs, specific sounds
  | 'fluency'            // timed speaking, pace control
  | 'fillers'            // reduce um/uh/like
  | 'grammar_patterns'   // specific structures (conditionals, passives, etc.)
  | 'vocabulary'         // use new words in context
  | 'shadowing'          // repeat after native audio
  | 'intotation'         // stress, rhythm, intonation
  | 'rapid_response';    // quick answers to prompts

export interface IDrillSession extends Document {
  userId: mongoose.Types.ObjectId;
  type: DrillType;
  /** Drill configuration */
  config: {
    /** Target sound/pattern for pronunciation drills */
    targetSound?: string;
    /** Grammar pattern for grammar drills */
    grammarPattern?: string;
    /** Time limit (seconds) */
    timeLimitSec?: number;
    /** Number of prompts */
    promptCount?: number;
    /** Difficulty level */
    difficulty?: 'easy' | 'medium' | 'hard';
  };
  /** Status */
  status: 'active' | 'completed' | 'abandoned';
  /** Prompts presented */
  prompts: Array<{
    text: string;
    expectedAnswer?: string;
    audioHash?: string;
  }>;
  /** User responses */
  responses: Array<{
    promptIndex: number;
    transcript: string;
    audioDurationMs: number;
    /** Graded score 0-100 */
    score: number | null;
    /** Filler count for this response */
    fillerCount: number;
    /** Pace (words per minute) */
    wpm: number | null;
  }>;
  /** Aggregate metrics */
  metrics: {
    avgScore: number | null;
    totalFillers: number;
    avgWpm: number | null;
    completionRate: number; // responses / prompts
  } | null;
  startedAt: Date;
  completedAt: Date | null;
}

const DrillSessionSchema = new Schema<IDrillSession>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: [
    'pronunciation', 'fluency', 'fillers', 'grammar_patterns',
    'vocabulary', 'shadowing', 'intotation', 'rapid_response'
  ], required: true },
  config: {
    targetSound: { type: String },
    grammarPattern: { type: String },
    timeLimitSec: { type: Number, min: 30, max: 600 },
    promptCount: { type: Number, min: 1, max: 50 },
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'] },
  },
  status: { type: String, enum: ['active', 'completed', 'abandoned'], default: 'active' },
  prompts: [{
    text: { type: String, required: true },
    expectedAnswer: { type: String },
    audioHash: { type: String },
  }],
  responses: [{
    promptIndex: { type: Number, required: true },
    transcript: { type: String, required: true },
    audioDurationMs: { type: Number, required: true },
    score: { type: Number, min: 0, max: 100, default: null },
    fillerCount: { type: Number, default: 0 },
    wpm: { type: Number, default: null },
  }],
  metrics: {
    avgScore: { type: Number, min: 0, max: 100, default: null },
    totalFillers: { type: Number, default: null },
    avgWpm: { type: Number, default: null },
    completionRate: { type: Number, min: 0, max: 1, default: null },
  },
  startedAt: { type: Date, required: true, default: Date.now },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

DrillSessionSchema.index({ userId: 1, type: 1, startedAt: -1 });

export const DrillSessionModel: Model<IDrillSession> = mongoose.model<IDrillSession>('DrillSession', DrillSessionSchema);

/**
 * Daily plan — personalized practice schedule for a day.
 */
export interface IDailyPlan extends Document {
  userId: mongoose.Types.ObjectId;
  /** Date (UTC midnight) */
  date: Date;
  /** Planned activities */
  activities: Array<{
    /** Type of activity */
    type: 'vocabulary_review' | 'drill' | 'conversation' | 'interview_practice';
    /** Duration in minutes */
    durationMin: number;
    /** Specific config */
    config: {
      /** For vocabulary: how many cards */
      cardCount?: number;
      /** For drill: drill type */
      drillType?: string;
      /** For conversation: topic */
      topic?: string;
      /** For interview: interview type */
      interviewType?: string;
    };
    /** Order in the day */
    order: number;
    /** Whether completed */
    completed: boolean;
    /** When completed */
    completedAt: Date | null;
    /** Actual duration */
    actualDurationMin: number | null;
  }>;
  /** Overall completion */
  completedCount: number;
  totalCount: number;
  /** Total planned minutes */
  totalPlannedMin: number;
  /** Total actual minutes */
  totalActualMin: number | null;
  /** Streak day number (0 if not a streak day) */
  streakDay: number;
  createdAt: Date;
  updatedAt: Date;
}

const DailyPlanSchema = new Schema<IDailyPlan>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  date: { type: Date, required: true, index: true },
  activities: [{
    type: { type: String, enum: ['vocabulary_review', 'drill', 'conversation', 'interview_practice'], required: true },
    durationMin: { type: Number, required: true, min: 5, max: 120 },
    config: {
      cardCount: { type: Number, min: 1, max: 100 },
      drillType: { type: String },
      topic: { type: String },
      interviewType: { type: String },
    },
    order: { type: Number, required: true },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
    actualDurationMin: { type: Number, default: null },
  }],
  completedCount: { type: Number, default: 0 },
  totalCount: { type: Number, default: 0 },
  totalPlannedMin: { type: Number, default: 0 },
  totalActualMin: { type: Number, default: null },
  streakDay: { type: Number, default: 0 },
}, { timestamps: true });

DailyPlanSchema.index({ userId: 1, date: 1 }, { unique: true });

export const DailyPlanModel: Model<IDailyPlan> = mongoose.model<IDailyPlan>('DailyPlan', DailyPlanSchema);

/**
 * Streak tracking — consecutive days of practice.
 */
export interface IStreak extends Document {
  userId: mongoose.Types.ObjectId;
  /** Current streak length (days) */
  currentStreak: number;
  /** Longest streak ever */
  longestStreak: number;
  /** Last day with activity (UTC date) */
  lastActiveDate: Date | null;
  /** Total active days */
  totalActiveDays: number;
  /** First activity date */
  firstActiveDate: Date | null;
  /** Streak freeze tokens (earned or purchased) */
  freezeTokens: number;
  updatedAt: Date;
}

const StreakSchema = new Schema<IStreak>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  currentStreak: { type: Number, default: 0, min: 0 },
  longestStreak: { type: Number, default: 0, min: 0 },
  lastActiveDate: { type: Date, default: null },
  totalActiveDays: { type: Number, default: 0, min: 0 },
  firstActiveDate: { type: Date, default: null },
  freezeTokens: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

export const StreakModel: Model<IStreak> = mongoose.model<IStreak>('Streak', StreakSchema);

/**
 * Progress snapshot — periodic snapshots for charts.
 */
export interface IProgressSnapshot extends Document {
  userId: mongoose.Types.ObjectId;
  /** Snapshot date (UTC midnight) */
  date: Date;
  /** Speaking metrics */
  speaking: {
    avgSci: number | null;
    avgFluency: number | null;
    avgAccuracy: number | null;
    avgComposure: number | null;
    totalSpeechMs: number;
    sessionCount: number;
  };
  /** Vocabulary metrics */
  vocabulary: {
    totalCards: number;
    dueCards: number;
    reviewedToday: number;
    avgEasinessFactor: number | null;
    retentionRate: number | null; // successful reviews / total reviews
  };
  /** Drill metrics */
  drills: {
    totalSessions: number;
    avgScore: number | null;
    totalFillers: number;
    avgWpm: number | null;
  };
  /** Interview metrics */
  interview: {
    totalSessions: number;
    avgReadiness: number | null;
    completedCount: number;
  };
  /** Streak */
  streak: {
    current: number;
    longest: number;
  };
  createdAt: Date;
}

const ProgressSnapshotSchema = new Schema<IProgressSnapshot>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  date: { type: Date, required: true, index: true },
  speaking: {
    avgSci: { type: Number, min: 0, max: 100, default: null },
    avgFluency: { type: Number, min: 0, max: 100, default: null },
    avgAccuracy: { type: Number, min: 0, max: 100, default: null },
    avgComposure: { type: Number, min: 0, max: 100, default: null },
    totalSpeechMs: { type: Number, default: 0 },
    sessionCount: { type: Number, default: 0 },
  },
  vocabulary: {
    totalCards: { type: Number, default: 0 },
    dueCards: { type: Number, default: 0 },
    reviewedToday: { type: Number, default: 0 },
    avgEasinessFactor: { type: Number, default: null },
    retentionRate: { type: Number, min: 0, max: 1, default: null },
  },
  drills: {
    totalSessions: { type: Number, default: 0 },
    avgScore: { type: Number, min: 0, max: 100, default: null },
    totalFillers: { type: Number, default: 0 },
    avgWpm: { type: Number, default: null },
  },
  interview: {
    totalSessions: { type: Number, default: 0 },
    avgReadiness: { type: Number, min: 0, max: 100, default: null },
    completedCount: { type: Number, default: 0 },
  },
  streak: {
    current: { type: Number, default: 0 },
    longest: { type: Number, default: 0 },
  },
}, { timestamps: true });

ProgressSnapshotSchema.index({ userId: 1, date: 1 }, { unique: true });

export const ProgressSnapshotModel: Model<IProgressSnapshot> = mongoose.model<IProgressSnapshot>('ProgressSnapshot', ProgressSnapshotSchema);