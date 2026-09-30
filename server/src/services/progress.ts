import type { IDailyPlan, IStreak, IProgressSnapshot } from '../models/DrillProgress';
import { getVocabularyStats } from './sm2';

// Type references to satisfy noUnusedLocals
const _typeRefs = { IDailyPlan: null as IDailyPlan | null, IStreak: null as IStreak | null, IProgressSnapshot: null as IProgressSnapshot | null, getVocabularyStats };
void _typeRefs;

/**
 * Daily plan generation and management
 */

export interface DailyPlanConfig {
  targetMinutes: number;           // Default 20
  vocabularyReviewWeight: number;  // 0-1
  drillWeight: number;
  conversationWeight: number;
  interviewWeight: number;
  preferredDrillTypes?: string[];
  preferredInterviewTypes?: string[];
}

const DEFAULT_CONFIG: DailyPlanConfig = {
  targetMinutes: 20,
  vocabularyReviewWeight: 0.3,
  drillWeight: 0.3,
  conversationWeight: 0.25,
  interviewWeight: 0.15,
};

/**
 * Generate a personalized daily plan for a user
 */
export async function generateDailyPlan(
  userId: string,
  date: Date = new Date(),
  config: Partial<DailyPlanConfig> = {}
): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { DailyPlanModel, DrillSessionModel } = await import('../models');

  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const targetDate = new Date(date);
  targetDate.setUTCHours(0, 0, 0, 0);

  // Check if plan already exists
  const existing = await DailyPlanModel.findOne({ userId, date: targetDate });
  if (existing) return existing;

  // Get vocabulary stats to determine review load
  const vocabStats = await getVocabularyStats(userId);
  const dueCards = vocabStats.dueCards;

  // Get recent drill history to suggest types
  const recentDrills = await DrillSessionModel.find({ userId })
    .sort({ startedAt: -1 })
    .limit(10)
    .select('type')
    .lean();

  const drillTypeCounts = recentDrills.reduce((acc: Record<string, number>, d) => {
    acc[d.type] = (acc[d.type] ?? 0) + 1;
    return acc;
  }, {});

  // Determine least practiced drill types
  const allDrillTypes = ['pronunciation', 'fluency', 'fillers', 'grammar_patterns', 'vocabulary', 'shadowing', 'intotation', 'rapid_response'];
  const sortedTypes = allDrillTypes.sort((a, b) => (drillTypeCounts[a] ?? 0) - (drillTypeCounts[b] ?? 0));

  const activities: Array<{ type: string; durationMin: number; config: Record<string, unknown>; order: number; completed: boolean; completedAt: Date | null; actualDurationMin: number | null }> = [];
  let order = 0;
  let totalPlanned = 0;

  // 1. Vocabulary review (if cards due)
  if (dueCards > 0) {
    const vocabMinutes = Math.min(
      Math.max(Math.ceil(dueCards / 10), 5),
      Math.round(mergedConfig.targetMinutes * mergedConfig.vocabularyReviewWeight)
    );
    if (vocabMinutes >= 5) {
      activities.push({
        type: 'vocabulary_review',
        durationMin: vocabMinutes,
        config: { cardCount: Math.min(dueCards, vocabMinutes * 2) },
        order: order++,
        completed: false,
        completedAt: null,
        actualDurationMin: null,
      });
      totalPlanned += vocabMinutes;
    }
  }

  // 2. Drill session (rotate through types)
  const drillMinutes = Math.round(mergedConfig.targetMinutes * mergedConfig.drillWeight);
  if (drillMinutes >= 5) {
    activities.push({
      type: 'drill',
      durationMin: drillMinutes,
      config: { drillType: sortedTypes[0] },
      order: order++,
      completed: false,
      completedAt: null,
      actualDurationMin: null,
    });
    totalPlanned += drillMinutes;
  }

  // 3. Conversation practice
  const convoMinutes = Math.round(mergedConfig.targetMinutes * mergedConfig.conversationWeight);
  if (convoMinutes >= 5) {
    activities.push({
      type: 'conversation',
      durationMin: convoMinutes,
      config: { topic: 'daily life' },
      order: order++,
      completed: false,
      completedAt: null,
      actualDurationMin: null,
    });
    totalPlanned += convoMinutes;
  }

  // 4. Interview practice (if user has been doing interviews)
  const hasInterviews = await (await import('../models')).PracticeSessionModel.exists({
    userId,
    type: 'interview',
  });

  if (hasInterviews) {
    const interviewMinutes = Math.round(mergedConfig.targetMinutes * mergedConfig.interviewWeight);
    if (interviewMinutes >= 5) {
      activities.push({
        type: 'interview_practice',
        durationMin: interviewMinutes,
        config: { interviewType: 'behavioral' },
        order: order++,
        completed: false,
        completedAt: null,
        actualDurationMin: null,
      });
      totalPlanned += interviewMinutes;
    }
  }

  // Create plan
  const plan = await DailyPlanModel.create({
    userId: userId,
    date: targetDate,
    activities,
    completedCount: 0,
    totalCount: activities.length,
    totalPlannedMin: totalPlanned,
    totalActualMin: null,
    streakDay: 0,
  });

  return plan;
}

/**
 * Get today's daily plan (creates if not exists)
 */
export async function getTodaysPlan(userId: string) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let plan = await (await import('../models')).DailyPlanModel.findOne({ userId, date: today });
  if (!plan) {
    plan = await generateDailyPlan(userId);
  }
  return plan;
}

/**
 * Mark an activity as completed
 */
export async function completeActivity(
  userId: string,
  date: Date,
  activityOrder: number,
  actualDurationMin: number
): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const targetDate = new Date(date);
  targetDate.setUTCHours(0, 0, 0, 0);

  const { DailyPlanModel } = await import('../models');
  const result = await DailyPlanModel.findOneAndUpdate(
    { userId, date: targetDate, 'activities.order': activityOrder },
    {
      $set: {
        'activities.$.completed': true,
        'activities.$.completedAt': new Date(),
        'activities.$.actualDurationMin': actualDurationMin,
      },
      $inc: { completedCount: 1, totalActualMin: actualDurationMin },
    },
    { new: true }
  ).lean().exec();

  if (!result) return null;

  // If all activities completed, update streak
  if (result.completedCount === result.totalCount) {
    await updateStreak(result.userId.toString(), new Date());
    // Update streak day
    const streak = await (await import('../models')).StreakModel.findOne({ userId: result.userId });
    if (streak) {
      await DailyPlanModel.findByIdAndUpdate(result._id, { streakDay: streak.currentStreak });
    }
  }

  // Return plain object to avoid Mongoose type issues
  return {
    _id: result._id,
    userId: result.userId,
    date: result.date,
    activities: result.activities,
    completedCount: result.completedCount,
    totalCount: result.totalCount,
    totalPlannedMin: result.totalPlannedMin,
    totalActualMin: result.totalActualMin,
    streakDay: result.streakDay,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
  };
}

/**
 * Streak management
 */
export async function updateStreak(userId: string, date: Date = new Date()) {
  const { StreakModel } = await import('../models');
  const today = new Date(date);
  today.setUTCHours(0, 0, 0, 0);

  let streak = await StreakModel.findOne({ userId });
  if (!streak) {
    streak = await StreakModel.create({
      userId,
      currentStreak: 1,
      longestStreak: 1,
      lastActiveDate: today,
      totalActiveDays: 1,
      firstActiveDate: today,
      freezeTokens: 0,
    });
    return streak;
  }

  const lastActive = streak.lastActiveDate ? new Date(streak.lastActiveDate) : null;
  if (lastActive) {
    lastActive.setUTCHours(0, 0, 0, 0);
  }

  const todayStart = new Date(today);
  todayStart.setUTCHours(0, 0, 0, 0);

  if (lastActive && lastActive.getTime() === todayStart.getTime()) {
    return streak;
  }

  let isConsecutive = false;
  if (lastActive) {
    const diffDays = Math.round((todayStart.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24));
    isConsecutive = diffDays === 1;
  } else {
    isConsecutive = true;
  }

  if (isConsecutive) {
    streak.currentStreak += 1;
    if (streak.currentStreak > streak.longestStreak) {
      streak.longestStreak = streak.currentStreak;
    }
  } else if (streak.freezeTokens > 0) {
    streak.freezeTokens -= 1;
  } else {
    streak.currentStreak = 1;
  }

  streak.lastActiveDate = today;
  streak.totalActiveDays += 1;
  if (!streak.firstActiveDate) {
    streak.firstActiveDate = today;
  }

  await streak.save();
  return streak;
}

/**
 * Get current streak info
 */
export async function getStreak(userId: string) {
  const { StreakModel } = await import('../models');
  const streak = await StreakModel.findOne({ userId });
  if (!streak) {
    return { currentStreak: 0, longestStreak: 0, totalActiveDays: 0, freezeTokens: 0 };
  }
  return {
    currentStreak: streak.currentStreak,
    longestStreak: streak.longestStreak,
    totalActiveDays: streak.totalActiveDays,
    freezeTokens: streak.freezeTokens,
    lastActiveDate: streak.lastActiveDate,
  };
}

/**
 * Generate progress snapshot for a date (for charts)
 */
export async function generateProgressSnapshot(userId: string, date: Date = new Date()) {
  const { ProgressSnapshotModel, PracticeSessionModel, TurnModel, DrillSessionModel } = await import('../models');

  const targetDate = new Date(date);
  targetDate.setUTCHours(0, 0, 0, 0);

  const existing = await ProgressSnapshotModel.findOne({ userId, date: targetDate });
  if (existing) return existing;

  // Get sessions for this date
  const nextDay = new Date(targetDate);
  nextDay.setDate(nextDay.getDate() + 1);

  const [sessions, vocabStats, drills, interviewAnswers] = await Promise.all([
    PracticeSessionModel.find({
      userId,
      startedAt: { $gte: targetDate, $lt: nextDay },
    }).lean(),
    getVocabularyStats(userId.toString()),
    DrillSessionModel.find({
      userId,
      startedAt: { $gte: targetDate, $lt: nextDay },
    }).lean(),
    (await import('../models')).InterviewAnswerModel.find({
      userId: (await import('../models')).PracticeSessionModel.modelName,
    }).lean().catch(() => []),
  ]);

  // Compute speaking metrics from today's turns
  const todayTurnIds = sessions.map(s => s._id.toString());
  const todayTurns = await TurnModel.find({ sessionId: { $in: todayTurnIds } }).lean();
  const turnMetrics = todayTurns.filter(t => t.metrics);

  const avgSci = turnMetrics.length
    ? Math.round(turnMetrics.reduce((s, t) => s + (t.metrics?.sci ?? 0), 0) / turnMetrics.length)
    : null;
  const avgFluency = turnMetrics.length
    ? Math.round(turnMetrics.reduce((s, t) => s + (t.metrics?.fluency ?? 0), 0) / turnMetrics.length)
    : null;
  const avgAccuracy = turnMetrics.length
    ? Math.round(turnMetrics.reduce((s, t) => s + (t.metrics?.accuracy ?? 0), 0) / turnMetrics.length)
    : null;
  const avgComposure = turnMetrics.length
    ? Math.round(turnMetrics.reduce((s, t) => s + (t.metrics?.composure ?? 0), 0) / turnMetrics.length)
    : null;
  const totalSpeechMs = todayTurns.reduce((s, t) => s + (t.evidence?.audioDurationMs ?? 0), 0);

  // Drill metrics
  const todayDrills = drills.filter(d => d.metrics);
  const avgDrillScore = todayDrills.length
    ? Math.round(todayDrills.reduce((s, d) => s + (d.metrics?.avgScore ?? 0), 0) / todayDrills.length)
    : null;
  const totalDrillFillers = todayDrills.reduce((s, d) => s + (d.metrics?.totalFillers ?? 0), 0);
  const avgDrillWpm = todayDrills.length
    ? Math.round(todayDrills.reduce((s, d) => s + (d.metrics?.avgWpm ?? 0), 0) / todayDrills.length)
    : null;

  // Interview readiness
  const interviewScores = interviewAnswers
    .filter(a => a.evaluation?.score !== null)
    .map(a => a.evaluation!.score);
  const avgReadiness = interviewScores.length
    ? Math.round(interviewScores.reduce((s, v) => s + v, 0) / interviewScores.length)
    : null;

  const streakData = await getStreak(userId.toString());

  const snapshot = await ProgressSnapshotModel.create({
    userId: userId,
    date: targetDate,
    speaking: {
      avgSci,
      avgFluency,
      avgAccuracy,
      avgComposure,
      totalSpeechMs,
      sessionCount: sessions.length,
    },
    vocabulary: {
      totalCards: vocabStats.totalCards,
      dueCards: vocabStats.dueCards,
      reviewedToday: vocabStats.reviewedToday,
      avgEasinessFactor: vocabStats.avgEasinessFactor,
      retentionRate: vocabStats.retentionRate,
    },
    drills: {
      totalSessions: drills.length,
      avgScore: avgDrillScore,
      totalFillers: totalDrillFillers,
      avgWpm: avgDrillWpm,
    },
    interview: {
      totalSessions: interviewAnswers.length,
      avgReadiness,
      completedCount: interviewAnswers.filter(a => a.evaluation).length,
    },
    streak: {
      current: streakData.currentStreak,
      longest: streakData.longestStreak,
    },
  });

  return snapshot;
}

/**
 * Get progress snapshots for a date range (for charts)
 */
export async function getProgressHistory(userId: string, days: number = 30) {
  const { ProgressSnapshotModel } = await import('../models');
  const endDate = new Date();
  endDate.setUTCHours(23, 59, 59, 999);

  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days + 1);
  startDate.setUTCHours(0, 0, 0, 0);

  const snapshots = await ProgressSnapshotModel.find({
    userId,
    date: { $gte: startDate, $lte: endDate },
  }).sort({ date: 1 }).lean();

  return snapshots;
}