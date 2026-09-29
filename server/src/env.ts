import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { isProviderId } from './config/providerIds';
import { logger } from './logging';

/**
 * Environment loading.
 *
 * Secrets live only on the server. The client never sees a provider key, and the
 * only way a learner can supply their own key is through the encrypted
 * bring-your-own-key path, which stores an AES-GCM ciphertext, never the key.
 */

function loadDotenv(): void {
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../.env')];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
  }
}
loadDotenv();

const booleanish = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((value) => {
      if (typeof value === 'boolean') return value;
      return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    });

const positiveInt = (defaultValue: number) => z.coerce.number().int().positive().default(defaultValue);

const providerChain = (fallback: string[]) =>
  z
    .string()
    .optional()
    .transform((value) =>
      (value ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    )
    .pipe(z.array(z.string()))
    .transform((ids) => (ids.length > 0 ? ids : fallback))
    .superRefine((ids, ctx) => {
      const seen = new Set<string>();
      for (const id of ids) {
        if (!isProviderId(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown provider "${id}". Known providers: see server/src/config/providerIds.ts`,
          });
          continue;
        }
        if (seen.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Provider "${id}" is listed twice in the same chain`,
          });
        }
        seen.add(id);
      }
    });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: booleanish(true),

  API_BASE_URL: z.string().url().default('http://localhost:8080'),
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? 'http://localhost:5173,http://127.0.0.1:5173')
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    )
    .pipe(z.array(z.string().url())),

  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017'),
  MONGODB_DB_NAME: z.string().regex(/^[a-z0-9_-]{1,64}$/).default('speaking_coach'),

  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  JWT_REFRESH_SECRET: z.string().min(32).optional(),
  ACCESS_TOKEN_TTL_SECONDS: positiveInt(900),
  REFRESH_TOKEN_TTL_DAYS: positiveInt(30),
  /**
   * 'lax' is enough while the client is served from the same site. Set 'none' when
   * the client and API are on different sites (for example Cloudflare Pages and a
   * Render service); it requires HTTPS, so it is refused in development.
   */
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional(),

  RESEND_API_KEY: z.string().min(10).optional(),
  MAIL_FROM: z.string().min(3).default('Speaking Coach <noreply@example.com>'),
  RESET_TOKEN_TTL_MINUTES: positiveInt(30),

  GROQ_API_KEY: z.string().min(10).optional(),
  GROQ_LLM_MODEL: z.string().default('openai/gpt-oss-20b'),
  GROQ_STT_MODEL: z.string().default('whisper-large-v3-turbo'),
  GROQ_TTS_MODEL: z.string().default('canopylabs/orpheus-v1-english'),

  CLOUDFLARE_ACCOUNT_ID: z.string().min(5).optional(),
  CLOUDFLARE_AI_TOKEN: z.string().min(10).optional(),
  WORKERS_LLM_MODEL: z.string().default('@cf/openai/gpt-oss-20b'),

  GEMINI_API_KEY: z.string().min(10).optional(),
  /** No default on purpose: current Gemini model ids must be checked by the operator. */
  GEMINI_LLM_MODEL: z.string().optional(),
  GEMINI_TTS_MODEL: z.string().optional(),

  OPENROUTER_API_KEY: z.string().min(10).optional(),
  /** No default: OpenRouter renames free models regularly. */
  OPENROUTER_LLM_MODEL: z.string().optional(),

  AZURE_SPEECH_KEY: z.string().min(10).optional(),
  AZURE_SPEECH_REGION: z.string().min(2).optional(),
  AZURE_SPEECH_TTS_VOICE: z.string().default('en-IN-NeerjaNeural'),

  OLLAMA_BASE_URL: z.string().url().optional(),
  OLLAMA_LLM_MODEL: z.string().default('qwen2.5:3b'),

  /**
   * Chains are ordered fallbacks. The first entry that is configured and has budget
   * left serves the request. Defaults use no card-required provider and no provider
   * whose free tier we cannot budget against.
   */
  CHAIN_STT: providerChain(['groq-stt', 'workersai-stt']),
  CHAIN_TTS: providerChain(['groq-tts']),
  CHAIN_LLM: providerChain(['groq-llm', 'workersai-llm']),

  /** Shallow probes are free (metadata endpoints). Deep probes cost real quota. */
  DEEP_PROBE: booleanish(false),
  PROBE_INTERVAL_MINUTES: positiveInt(15),

  BYOK_ENABLED: booleanish(true),
  /** 32 bytes as 64 hex characters or base64. Required in production when BYOK is on. */
  BYOK_ENCRYPTION_KEY: z.string().min(32).optional(),

  /** Friendly daily goal, not a paywall. Interview mocks get reserved capacity. */
  FAIR_USE_DAILY_SPEAKING_MINUTES: positiveInt(20),
  INTERVIEW_RESERVED_MINUTES: positiveInt(10),

  RATE_LIMIT_AUTH_PER_15_MIN: positiveInt(10),
  RATE_LIMIT_API_PER_MIN: positiveInt(240),
  /** Audio is never stored unless the learner explicitly turns it on. */
  AUDIO_STORAGE_ENABLED: booleanish(false),
});

export type EnvInput = z.infer<typeof schema>;

export interface Env extends Omit<EnvInput, 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET' | 'BYOK_ENCRYPTION_KEY'> {
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  byokEncryptionKey: Buffer | null;
  /** True when a secret was generated for this process instead of configured. */
  ephemeralSecrets: boolean;
  generatedSecretNames: string[];
}

export class EnvError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n- ${issues.join('\n- ')}`);
    this.name = 'EnvError';
    this.issues = issues;
  }
}

function parseEncryptionKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return Buffer.from(trimmed, 'hex');
  const decoded = Buffer.from(trimmed, 'base64');
  if (decoded.length === 32) return decoded;
  throw new EnvError([
    'BYOK_ENCRYPTION_KEY must be 32 bytes: either 64 hex characters or a base64 string of exactly 32 bytes.',
  ]);
}

function collectFieldErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.') || '(root)';
    return `${path}: ${issue.message}`;
  });
}

/**
 * Treat a blank value as "not set".
 *
 * dotenv turns `GROQ_API_KEY=` into an empty string, so a perfectly ordinary
 * `.env` copied from the example file would otherwise fail validation on eleven
 * optional secrets instead of starting cleanly. Values are trimmed as well, since
 * a trailing space in a pasted key is a very easy mistake to make and a very
 * annoying one to debug.
 */
function sanitize(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string') {
      if (value !== undefined) result[key] = value;
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) result[key] = trimmed;
  }
  return result;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(sanitize(source));
  if (!parsed.success) throw new EnvError(collectFieldErrors(parsed.error));
  const input = parsed.data;

  const problems: string[] = [];
  const generatedSecretNames: string[] = [];
  let jwtAccessSecret = input.JWT_ACCESS_SECRET ?? '';
  let jwtRefreshSecret = input.JWT_REFRESH_SECRET ?? '';
  let byokEncryptionKey: Buffer | null = null;

  try {
    byokEncryptionKey = parseEncryptionKey(input.BYOK_ENCRYPTION_KEY);
  } catch (error) {
    problems.push(error instanceof EnvError ? error.issues[0] ?? 'Invalid BYOK_ENCRYPTION_KEY' : 'Invalid BYOK_ENCRYPTION_KEY');
  }

  if (!jwtAccessSecret || !jwtRefreshSecret) {
    if (input.NODE_ENV === 'production') {
      if (!jwtAccessSecret) problems.push('JWT_ACCESS_SECRET is required in production (32+ characters).');
      if (!jwtRefreshSecret) problems.push('JWT_REFRESH_SECRET is required in production (32+ characters).');
    } else {
      if (!jwtAccessSecret) {
        jwtAccessSecret = randomBytes(48).toString('base64url');
        generatedSecretNames.push('JWT_ACCESS_SECRET');
      }
      if (!jwtRefreshSecret) {
        jwtRefreshSecret = randomBytes(48).toString('base64url');
        generatedSecretNames.push('JWT_REFRESH_SECRET');
      }
    }
  }

  if (jwtAccessSecret && jwtAccessSecret === jwtRefreshSecret) {
    problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values.');
  }

  if (input.BYOK_ENABLED && input.NODE_ENV === 'production' && byokEncryptionKey === null) {
    problems.push('BYOK_ENCRYPTION_KEY is required in production while BYOK_ENABLED is on.');
  }
  if (input.COOKIE_SAMESITE === 'none' && input.NODE_ENV !== 'production') {
    problems.push('COOKIE_SAMESITE=none is only allowed in production because it requires HTTPS cookies.');
  }

  if (!input.CHAIN_LLM) problems.push('CHAIN_LLM must contain at least one provider.');
  if (!input.CHAIN_STT) problems.push('CHAIN_STT must contain at least one provider.');
  if (!input.CHAIN_TTS) problems.push('CHAIN_TTS must contain at least one provider.');

  if (input.NODE_ENV === 'production') {
    const configuredProviders = [
      'groq-llm',
      'groq-stt',
      'groq-tts',
      'workersai-llm',
      'workersai-stt',
      'gemini-llm',
      'gemini-tts',
      'openrouter-llm',
      'azure-stt',
      'azure-tts',
      'ollama-llm',
    ].filter((id) => isProviderConfiguredFromSource(id, input));
    if (configuredProviders.length === 0) {
      problems.push(
        'No provider credentials are configured. The service cannot answer a single request without one of GROQ_API_KEY, CLOUDFLARE_AI_TOKEN + CLOUDFLARE_ACCOUNT_ID, GEMINI_API_KEY, OPENROUTER_API_KEY, AZURE_SPEECH_KEY + AZURE_SPEECH_REGION or OLLAMA_BASE_URL.',
      );
    }
  }

  if (problems.length > 0) throw new EnvError(problems);

  const env: Env = {
    ...input,
    jwtAccessSecret,
    jwtRefreshSecret,
    byokEncryptionKey,
    ephemeralSecrets: generatedSecretNames.length > 0,
    generatedSecretNames,
  };

  if (generatedSecretNames.length > 0) {
    logger.warn(
      { secrets: generatedSecretNames },
      'Generated ephemeral secrets for this process. Sessions will not survive a restart. Set them in .env before deploying.',
    );
  }

  return env;
}

/** Raw-source credential check used during validation, before the Env object exists. */
function isProviderConfiguredFromSource(id: string, input: EnvInput): boolean {
  switch (id) {
    case 'groq-llm':
    case 'groq-stt':
    case 'groq-tts':
      return Boolean(input.GROQ_API_KEY);
    case 'workersai-llm':
    case 'workersai-stt':
      return Boolean(input.CLOUDFLARE_AI_TOKEN && input.CLOUDFLARE_ACCOUNT_ID);
    case 'gemini-llm':
      return Boolean(input.GEMINI_API_KEY && input.GEMINI_LLM_MODEL);
    case 'gemini-tts':
      return Boolean(input.GEMINI_API_KEY && input.GEMINI_TTS_MODEL);
    case 'openrouter-llm':
      return Boolean(input.OPENROUTER_API_KEY && input.OPENROUTER_LLM_MODEL);
    case 'azure-stt':
    case 'azure-tts':
      return Boolean(input.AZURE_SPEECH_KEY && input.AZURE_SPEECH_REGION);
    case 'ollama-llm':
      return Boolean(input.OLLAMA_BASE_URL);
    default:
      return false;
  }
}

let cached: Env | null = null;

export function env(): Env {
  if (cached === null) cached = loadEnv();
  return cached;
}

/** Test helper: forget the cached environment. */
export function resetEnvCache(): void {
  cached = null;
}
