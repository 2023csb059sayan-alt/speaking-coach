/**
 * SM-2 Spaced Repetition Algorithm Implementation
 *
 * Based on the original SuperMemo 2 algorithm (Piotr Woźniak, 1987).
 * Grades: 0-5 (0 = complete blackout, 5 = perfect recall)
 *
 * Rules:
 * - Grade >= 3: successful review, advance interval
 * - Grade < 3: failed review, reset repetitions, interval = 1 day
 * - EF (easiness factor) adjusts based on grade
 * - Minimum EF = 1.3
 */

export interface Sm2Input {
  /** Current easiness factor (default 2.5, min 1.3) */
  easinessFactor: number;
  /** Current interval in days */
  intervalDays: number;
  /** Number of successful consecutive reviews */
  repetitions: number;
  /** Grade 0-5 */
  grade: number;
  /** Current date (for testing) */
  now?: Date;
}

export interface Sm2Output {
  /** Updated easiness factor */
  easinessFactor: number;
  /** Updated interval in days */
  intervalDays: number;
  /** Updated repetitions count */
  repetitions: number;
  /** Next review date */
  nextReviewAt: Date;
  /** Whether this was a successful review (grade >= 3) */
  success: boolean;
  /** Whether this was a lapse (grade < 3) */
  lapse: boolean;
}

/**
 * Compute next review using SM-2 algorithm.
 */
export function computeSm2(input: Sm2Input): Sm2Output {
  const { easinessFactor, intervalDays, repetitions, grade } = input;
  const now = input.now ?? new Date();

  // Clamp grade
  const g = Math.max(0, Math.min(5, Math.round(grade)));

  let newEf = easinessFactor;
  let newInterval = intervalDays;
  let newReps = repetitions;
  let success = false;
  let lapse = false;

  if (g >= 3) {
    // Successful review
    success = true;

    if (repetitions === 0) {
      newInterval = 1;
    } else if (repetitions === 1) {
      newInterval = 6;
    } else {
      newInterval = Math.round(intervalDays * easinessFactor);
    }
    newReps = repetitions + 1;
  } else {
    // Failed review - reset
    lapse = true;
    newReps = 0;
    newInterval = 1;
  }

  // Update easiness factor
  // EF' = EF + (0.1 - (5 - g) * (0.08 + (5 - g) * 0.02))
  const efDelta = 0.1 - (5 - g) * (0.08 + (5 - g) * 0.02);
  newEf = Math.max(1.3, easinessFactor + efDelta);

  // Calculate next review date
  const nextReviewAt = new Date(now);
  nextReviewAt.setDate(now.getDate() + newInterval);
  // Set to start of day (UTC midnight) for consistent scheduling
  nextReviewAt.setUTCHours(0, 0, 0, 0);

  return {
    easinessFactor: Math.round(newEf * 1000) / 1000, // 3 decimal places
    intervalDays: newInterval,
    repetitions: newReps,
    nextReviewAt,
    success,
    lapse,
  };
}

/**
 * Grade descriptions for UI
 */
export const SM2_GRADES = [
  { value: 0, label: 'Complete blackout', description: 'No recall at all' },
  { value: 1, label: 'Incorrect', description: 'Wrong answer, but recognized' },
  { value: 2, label: 'Hard', description: 'Correct with significant difficulty' },
  { value: 3, label: 'Good', description: 'Correct with some difficulty' },
  { value: 4, label: 'Easy', description: 'Correct, relatively easy' },
  { value: 5, label: 'Perfect', description: 'Perfect recall, instantaneous' },
] as const;

/**
 * Get due cards for a user.
 */
export async function getDueCards(
  userId: string,
  limit: number = 50,
  now: Date = new Date()
) {
  const { VocabularyCardModel } = await import('../models');
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);

  return VocabularyCardModel.find({
    userId,
    nextReviewAt: { $lte: startOfDay },
  })
    .sort({ nextReviewAt: 1, easinessFactor: 1 })
    .limit(limit)
    .lean();
}

/**
 * Get vocabulary stats for a user.
 */
export async function getVocabularyStats(userId: string) {
  const { VocabularyCardModel } = await import('../models');
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [total, due, reviewedToday, allCards] = await Promise.all([
    VocabularyCardModel.countDocuments({ userId }),
    VocabularyCardModel.countDocuments({ userId, nextReviewAt: { $lte: startOfDay } }),
    VocabularyCardModel.countDocuments({
      userId,
      lastReviewedAt: { $gte: startOfDay },
    }),
    VocabularyCardModel.find({ userId })
      .select('easinessFactor reviewCount lapseCount')
      .lean(),
  ]);

  let avgEf = 2.5;
  let retentionRate = 0;
  if (allCards.length > 0) {
    avgEf = allCards.reduce((sum, c) => sum + c.easinessFactor, 0) / allCards.length;
    const totalReviews = allCards.reduce((sum, c) => sum + c.reviewCount, 0);
    const totalLapses = allCards.reduce((sum, c) => sum + c.lapseCount, 0);
    retentionRate = totalReviews > 0 ? 1 - totalLapses / totalReviews : 1;
  }

  return {
    totalCards: total,
    dueCards: due,
    reviewedToday,
    avgEasinessFactor: Math.round(avgEf * 1000) / 1000,
    retentionRate: Math.round(retentionRate * 1000) / 1000,
  };
}

/**
 * Add a new vocabulary card (or update existing).
 */
export async function addVocabularyCard(
  userId: string,
  card: {
    term: string;
    definition: string;
    example?: string;
    ipa?: string;
    tags?: string[];
    source: string;
    sourceRefId?: string;
  }
) {
  const { VocabularyCardModel } = await import('../models');
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);

  // Upsert: if term exists for this user, update; else create
  const existing = await VocabularyCardModel.findOne({ userId, term: card.term });
  if (existing) {
    // Update definition/example but keep SM-2 schedule
    existing.definition = card.definition;
    existing.example = card.example ?? existing.example;
    existing.ipa = card.ipa ?? existing.ipa;
    existing.tags = Array.from(new Set([...existing.tags, ...(card.tags ?? [])]));
    existing.source = card.source;
    existing.sourceRefId = card.sourceRefId ?? existing.sourceRefId;
    await existing.save();
    return existing;
  }

  return VocabularyCardModel.create({
    userId,
    ...card,
    easinessFactor: 2.5,
    intervalDays: 0,
    repetitions: 0,
    nextReviewAt: now,
    lastReviewedAt: null,
    reviewCount: 0,
    lapseCount: 0,
  });
}