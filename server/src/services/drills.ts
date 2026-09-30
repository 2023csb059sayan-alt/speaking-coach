import type { DrillType } from '../models/DrillProgress';

const _typeRefs = { DrillType: null as DrillType | null };
void _typeRefs;

/**
 * Drill prompt generators for different drill types.
 */

export interface DrillPrompt {
  text: string;
  expectedAnswer?: string;
  audioHash?: string;
}

export interface DrillConfig {
  type: DrillType;
  targetSound?: string;
  grammarPattern?: string;
  timeLimitSec?: number;
  promptCount?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
}

/**
 * Pronunciation drill prompts - minimal pairs and specific sounds
 */
const PRONUNCIATION_PROMPTS: Record<string, DrillPrompt[]> = {
  'v_w': [
    { text: 'Say: "The very wise wizard visited the village."', expectedAnswer: 'The very wise wizard visited the village.' },
    { text: 'Say: "Vincent\'s velvet vest vanished."', expectedAnswer: 'Vincent\'s velvet vest vanished.' },
    { text: 'Say: "We won the wonderful award."', expectedAnswer: 'We won the wonderful award.' },
    { text: 'Say: "Will you watch the white whales?"', expectedAnswer: 'Will you watch the white whales?' },
  ],
  'th_d': [
    { text: 'Say: "The dog dug deep this day."', expectedAnswer: 'The dog dug deep this day.' },
    { text: 'Say: "That\'s the third thing they thought."', expectedAnswer: 'That\'s the third thing they thought.' },
  ],
  'r_l': [
    { text: 'Say: "Red lorry, yellow lorry."', expectedAnswer: 'Red lorry, yellow lorry.' },
    { text: 'Say: "Really rural, rarely really rural."', expectedAnswer: 'Really rural, rarely really rural.' },
  ],
  's_sh': [
    { text: 'Say: "She sells sea shells."', expectedAnswer: 'She sells sea shells.' },
    { text: 'Say: "Sure, she saw the ship."', expectedAnswer: 'Sure, she saw the ship.' },
  ],
  'b_p': [
    { text: 'Say: "Big pigs bit the pink pie."', expectedAnswer: 'Big pigs bit the pink pie.' },
    { text: 'Say: "Peter Piper picked a peck."', expectedAnswer: 'Peter Piper picked a peck.' },
  ],
};

const DEFAULT_PRONUNCIATION_PROMPTS: DrillPrompt[] = [
  { text: 'Read: "The quick brown fox jumps over the lazy dog."' },
  { text: 'Read: "She sells seashells by the seashore."' },
  { text: 'Read: "How much wood would a woodchuck chuck?"' },
  { text: 'Read: "Peter Piper picked a peck of pickled peppers."' },
  { text: 'Read: "Betty Botter bought some butter."' },
];

/**
 * Fluency drill prompts - timed speaking
 */
const FLUENCY_PROMPTS: DrillPrompt[] = [
  { text: 'Describe your morning routine in detail.' },
  { text: 'Explain how to make your favorite dish step by step.' },
  { text: 'Talk about a memorable trip you took.' },
  { text: 'Describe your ideal weekend.' },
  { text: 'Explain how to use a smartphone to someone who never saw one.' },
  { text: 'Tell a story about a challenge you overcame.' },
  { text: 'Describe your dream job and why you want it.' },
  { text: 'Explain the plot of your favorite movie.' },
];

/**
 * Filler reduction drill prompts
 */
const FILLER_PROMPTS: DrillPrompt[] = [
  { text: 'Explain your job without using "um", "uh", "like", or "you know".' },
  { text: 'Describe your hometown without fillers.' },
  { text: 'Give directions to a nearby landmark without hesitation.' },
  { text: 'Explain a complex topic simply, avoiding "actually", "basically".' },
];

/**
 * Grammar pattern drills
 */
const GRAMMAR_PROMPTS: Record<string, DrillPrompt[]> = {
  'conditionals': [
    { text: 'Complete: "If I had more time, I ______ (learn) a new language."', expectedAnswer: 'would learn' },
    { text: 'Complete: "If it rains tomorrow, we ______ (stay) inside."', expectedAnswer: 'will stay' },
    { text: 'Complete: "If I ______ (be) you, I would apply for that job."', expectedAnswer: 'were' },
    { text: 'Make a sentence using the second conditional about a dream job.' },
  ],
  'passives': [
    { text: 'Rewrite in passive: "Someone cleaned the room."', expectedAnswer: 'The room was cleaned.' },
    { text: 'Rewrite in passive: "They are building a new bridge."', expectedAnswer: 'A new bridge is being built.' },
    { text: 'Rewrite in passive: "We will finish the project by Friday."', expectedAnswer: 'The project will be finished by Friday.' },
  ],
  'reported_speech': [
    { text: 'Convert to reported speech: "She said, \'I am tired.\'"', expectedAnswer: 'She said that she was tired.' },
    { text: 'Convert: "He told me, \'I will call you.\'"', expectedAnswer: 'He told me that he would call me.' },
  ],
};

/**
 * Vocabulary in context drills
 */
const VOCAB_PROMPTS: DrillPrompt[] = [
  { text: 'Use "substantial" in a sentence about a meal.' },
  { text: 'Use "mitigate" in a sentence about risk.' },
  { text: 'Use "articulate" in a sentence about speaking.' },
  { text: 'Use "comprehensive" in a sentence about a report.' },
  { text: 'Use "elaborate" in a sentence about a plan.' },
];

/**
 * Shadowing drill prompts (repeat after native-like audio)
 */
const SHADOWING_PROMPTS: DrillPrompt[] = [
  { text: 'Repeat: "The meeting has been postponed until further notice."' },
  { text: 'Repeat: "Could you please send me the report by Friday?"' },
  { text: 'Repeat: "I appreciate your prompt attention to this matter."' },
  { text: 'Repeat: "We look forward to hearing from you soon."' },
  { text: 'Repeat: "Please let me know if you have any questions."' },
];

/**
 * Intonation/stress drills
 */
const INTONATION_PROMPTS: DrillPrompt[] = [
  { text: 'Say with rising intonation: "Are you coming?"' },
  { text: 'Say with falling intonation: "I\'m not sure about that."' },
  { text: 'Say with emphasis on "YOU": "Did YOU do this?"' },
  { text: 'Say with emphasis on "THIS": "Is THIS the right one?"' },
  { text: 'Read with proper sentence stress: "The NEW manager wants to see YOU."' },
];

/**
 * Rapid response drills
 */
const RAPID_RESPONSE_PROMPTS: DrillPrompt[] = [
  { text: 'What\'s your name?' },
  { text: 'Where are you from?' },
  { text: 'What do you do?' },
  { text: 'Why are you learning English?' },
  { text: 'What\'s your favorite food?' },
  { text: 'How do you get to work?' },
  { text: 'What did you do yesterday?' },
  { text: 'What are your plans for the weekend?' },
];

/**
 * Get prompts for a drill configuration
 */
export function getDrillPrompts(config: DrillConfig): DrillPrompt[] {
  const count = config.promptCount ?? 5;

  switch (config.type) {
    case 'pronunciation':
      if (config.targetSound) {
        const prompts = PRONUNCIATION_PROMPTS[config.targetSound];
        if (prompts) {
          return shuffleArray(prompts).slice(0, count);
        }
      }
      return shuffleArray(DEFAULT_PRONUNCIATION_PROMPTS).slice(0, count);

    case 'fluency':
      return shuffleArray(FLUENCY_PROMPTS).slice(0, count);

    case 'fillers':
      return shuffleArray(FILLER_PROMPTS).slice(0, count);

    case 'grammar_patterns':
      if (config.grammarPattern) {
        const prompts: DrillPrompt[] | undefined = GRAMMAR_PROMPTS[config.grammarPattern];
        if (prompts) {
          return shuffleArray(prompts).slice(0, count);
        }
      }
      // Fallback: mix all grammar prompts
      {
        const allGrammar = Object.values(GRAMMAR_PROMPTS).flat();
        return shuffleArray(allGrammar).slice(0, count);
      }

    case 'vocabulary':
      return shuffleArray(VOCAB_PROMPTS).slice(0, count);

    case 'shadowing':
      return shuffleArray(SHADOWING_PROMPTS).slice(0, count);

    case 'intotation':
      return shuffleArray(INTONATION_PROMPTS).slice(0, count);

    case 'rapid_response':
      return shuffleArray(RAPID_RESPONSE_PROMPTS).slice(0, count);

    default:
      return shuffleArray(FLUENCY_PROMPTS).slice(0, count);
  }
}

/**
 * Compute WPM from transcript and duration
 */
export function computeWpm(transcript: string, durationMs: number): number {
  const words = transcript.trim().split(/\s+/).filter(w => w.length > 0).length;
  const minutes = durationMs / 60000;
  if (minutes <= 0) return 0;
  return Math.round(words / minutes);
}

/**
 * Count filler words in transcript
 */
export function countFillers(transcript: string): number {
  const fillers = /\b(um|uh|er|ah|like|you know|i mean|sort of|kind of|actually|basically|so|well)\b/gi;
  return (transcript.match(fillers) ?? []).length;
}

/**
 * Fisher-Yates shuffle
 */
function shuffleArray<T>(array: readonly T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }
  return result;
}