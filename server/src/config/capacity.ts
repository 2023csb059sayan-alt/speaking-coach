/**
 * Capacity arithmetic for the shared free quota.
 *
 * These are estimates, not measurements, and they are computed from the verified
 * free-tier numbers in `freeTiers.ts`. They are here so the honesty of "free
 * forever" is a number we can check rather than a promise we make. The
 * `/health/budget` endpoint reports live usage against the same limits.
 *
 * Assumed per learner: 20 speaking minutes a day, about 30 turns in a 10-minute
 * session, 350 prompt tokens and at most 90 reply tokens per turn, and one
 * evaluation call per session.
 */

export const CAPACITY_ASSUMPTIONS = {
  speakingMinutesPerLearnerPerDay: 20,
  turnsPerTenMinuteSession: 30,
  promptTokensPerTurn: 350,
  replyTokensPerTurn: 90,
  evaluationTokensPerSession: { input: 2_500, output: 1_500 },
  /** Share of learners whose browser can transcribe and speak on-device. */
  onDeviceShare: 0.5,
  averageSecondsOfAudioPerTurn: 10,
} as const;

export interface CapacityLine {
  providerId: string;
  dailyAllowanceSeconds: number;
  dailyAllowanceTokens: number;
  learnersServableAtAssumedUsage: number | null;
  basis: string;
}

/**
 * Groq speech-to-text allows 28,800 audio seconds a day, which is 480 minutes. At
 * 20 minutes of speech per learner per day that is 24 learners using the server
 * path, doubled when half the learners are handled on-device.
 */
const GROQ_STT_DAILY_AUDIO_SECONDS = 28_800;
const GROQ_LLM_DAILY_TOKENS = 200_000;

const tokensPerLearnerPerDay =
  CAPACITY_ASSUMPTIONS.turnsPerTenMinuteSession * 2 *
  (CAPACITY_ASSUMPTIONS.promptTokensPerTurn + CAPACITY_ASSUMPTIONS.replyTokensPerTurn) +
  CAPACITY_ASSUMPTIONS.evaluationTokensPerSession.input +
  CAPACITY_ASSUMPTIONS.evaluationTokensPerSession.output;

const SERVER_SHARE = 1 - CAPACITY_ASSUMPTIONS.onDeviceShare;

export const CAPACITY_LINES: CapacityLine[] = [
  {
    providerId: 'groq-stt',
    dailyAllowanceSeconds: GROQ_STT_DAILY_AUDIO_SECONDS,
    dailyAllowanceTokens: 0,
    learnersServableAtAssumedUsage: Math.floor(
      (GROQ_STT_DAILY_AUDIO_SECONDS / (CAPACITY_ASSUMPTIONS.speakingMinutesPerLearnerPerDay * 60)) / SERVER_SHARE,
    ),
    basis: '28,800 audio seconds per day divided by 1,200 server-side speech seconds per learner.',
  },
  {
    providerId: 'groq-llm',
    dailyAllowanceSeconds: 0,
    dailyAllowanceTokens: GROQ_LLM_DAILY_TOKENS,
    learnersServableAtAssumedUsage: Math.floor(GROQ_LLM_DAILY_TOKENS / tokensPerLearnerPerDay),
    basis: `200,000 tokens per day divided by ${tokensPerLearnerPerDay} tokens per learner (two 10-minute sessions plus evaluations).`,
  },
  {
    providerId: 'workersai-stt',
    dailyAllowanceSeconds: Math.floor((10_000 / 41.14) * 60),
    dailyAllowanceTokens: 0,
    learnersServableAtAssumedUsage: null,
    basis: '10,000 neurons per day at about 41.14 neurons per audio minute, roughly 240 audio minutes in total.',
  },
  {
    providerId: 'groq-tts',
    dailyAllowanceSeconds: 0,
    dailyAllowanceTokens: 0,
    learnersServableAtAssumedUsage: null,
    basis: 'Only 10 requests a minute and 3,600 tokens a day, so this voice is a fallback rather than the main path.',
  },
];

export const FAIR_USE_HEADROOM_NOTES = {
  assumptions: CAPACITY_ASSUMPTIONS,
  tokensPerLearnerPerDay,
  lines: CAPACITY_LINES,
  headline:
    'On the shared free chain we can serve roughly 45 to 60 daily active learners at 20 speaking minutes each. A learner who adds their own provider key adds an independent cohort without costing us anything.',
  growthPaths: [
    'On-device speech recognition removes the transcription bottleneck, which is the first thing to saturate.',
    'Every learner can bring their own key, so the shared pool stops being the ceiling.',
    'Session evaluation is batched once per session rather than per turn, which is why tokens per learner stay flat as sessions get longer.',
  ],
  honesty:
    'These are estimates from published limits, not measurements. The budget endpoint reports what we actually used today so the two can be compared.',
} as const;
