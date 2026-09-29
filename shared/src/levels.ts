/**
 * Proficiency levels.
 *
 * The learner-facing UI never shows CEFR codes: it shows a plain label such as
 * "Getting started". The internal enum is only used for rubric selection and for
 * report copy that we generate server-side.
 */

export const PROFICIENCY_LEVELS = [
  'beginner',
  'elementary',
  'intermediate',
  'upper_intermediate',
  'advanced',
] as const;

export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number];

export const PLAIN_LEVEL_LABELS: Record<ProficiencyLevel, string> = {
  beginner: 'Starting out',
  elementary: 'Getting comfortable',
  intermediate: 'Holding a conversation',
  upper_intermediate: 'Fluent most of the time',
  advanced: 'Comfortable in any setting',
};

export function plainLevelLabel(level: ProficiencyLevel): string {
  return PLAIN_LEVEL_LABELS[level];
}

export function isProficiencyLevel(value: unknown): value is ProficiencyLevel {
  return typeof value === 'string' && (PROFICIENCY_LEVELS as readonly string[]).includes(value);
}

/**
 * Rough placement only. Never presented to the learner as a scored result:
 * it is a starting hint used to choose prompt difficulty, adjusted by the
 * in-session check-ins the tutor runs anyway.
 */
export function starterLevelForTestsPassed(count: number): ProficiencyLevel {
  if (count <= 2) return 'elementary';
  if (count <= 4) return 'intermediate';
  return 'upper_intermediate';
}
