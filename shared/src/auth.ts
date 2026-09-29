import { z } from 'zod';

/** Languages the learner can ask for explanations in. */
export const SUPPORTED_LANGUAGES = ['en', 'hi', 'bn', 'ta', 'te', 'mr'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  hi: 'Hindi',
  bn: 'Bengali',
  ta: 'Tamil',
  te: 'Telugu',
  mr: 'Marathi',
};

/** The script the learner wants to see, decided by them rather than guessed. */
export const SUPPORTED_SCRIPTS = [
  'latin',
  'devanagari',
  'bengali',
  'tamil',
  'telugu',
  'marathi',
] as const;
export type SupportedScript = (typeof SUPPORTED_SCRIPTS)[number];

export const SUPPORTED_LANGUAGE_SCRIPTS: Record<SupportedLanguage, SupportedScript[]> = {
  en: ['latin'],
  hi: ['latin', 'devanagari'],
  bn: ['latin', 'bengali'],
  ta: ['latin', 'tamil'],
  te: ['latin', 'telugu'],
  mr: ['latin', 'marathi'],
};

/**
 * A deliberately small blocklist. We do not run a heavy zxcvbn pass on the API,
 * because scoring passwords server-side keeps learner data we do not need.
 */
export const COMMON_PASSWORDS = [
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  'qwerty123',
  'iloveyou',
  'welcome1',
  'admin123',
  'abc12345',
  'letmein1',
  'monkey12',
] as const;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email('Enter a valid email address')
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, 'That password is too long')
  .refine((value) => value.trim().length === value.length, 'Remove the spaces at the start or end')
  .refine((value) => /\d/.test(value), 'Add at least one number')
  .refine(
    (value) => !COMMON_PASSWORDS.includes(value.trim().toLowerCase() as (typeof COMMON_PASSWORDS)[number]),
    'That password is very common. Please choose another one.',
  );

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Tell us what to call you')
  .max(60, 'Keep it under 60 characters');

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema.optional(),
  /** Optional at sign-up; honoured without nagging when left empty. */
  nativeLanguage: z.enum(SUPPORTED_LANGUAGES).default('en'),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'Please accept the privacy notice to continue' }),
  }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const INTERVIEW_TYPES = [
  'hr',
  'behavioral',
  'technical',
  'situational',
  'campus',
  'panel',
  'stress',
  'full_mock',
] as const;
export type InterviewType = (typeof INTERVIEW_TYPES)[number];

export const INTERVIEW_TYPE_LABELS: Record<InterviewType, string> = {
  hr: 'HR round',
  behavioral: 'Behavioural questions',
  technical: 'Explaining your technical work',
  situational: 'What would you do situations',
  campus: 'Campus placement',
  panel: 'Panel interview',
  stress: 'Under pressure',
  full_mock: 'Full mock interview',
};

export const INTERVIEW_MODES = ['practice', 'exam'] as const;
export type InterviewMode = (typeof INTERVIEW_MODES)[number];

/** Free-tier reality: 10 minutes fits comfortably inside the shared daily budget. */
export const MOCK_LENGTH_MINUTES = { min: 5, default: 10, max: 20 } as const;

export const updateProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  nativeLanguage: z.enum(SUPPORTED_LANGUAGES).optional(),
  nativeLanguageScript: z.enum(SUPPORTED_SCRIPTS).optional(),
  targetRole: z.string().trim().max(80).optional(),
  targetDomain: z.string().trim().max(80).optional(),
  confidenceMode: z.boolean().optional(),
  captionsAlwaysOn: z.boolean().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const byokProviderSchema = z.object({
  providerId: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{3,40}$/, 'Unknown provider')
    .describe('Server provider id, for example "groq-llm"'),
  apiKey: z.string().trim().min(16).max(300),
  label: z.string().trim().max(40).optional(),
});
export type ByokInput = z.infer<typeof byokProviderSchema>;
