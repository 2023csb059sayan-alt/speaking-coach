import type {
  ErrorCode,
  FreeQuota,
  FreeQuotaLimit,
  ProviderCapabilities,
  ProviderKind,
  QuotaUnit,
  QuotaWindow,
} from '@speaking-coach/shared';

/**
 * Thin API client.
 *
 * Two rules that matter here:
 *   - the session token is an httpOnly cookie, so there is nothing to store in
 *     localStorage and nothing for a script injection to steal;
 *   - every state-changing request carries the `x-sc-client` header, which the API
 *     requires as CSRF protection for cookie-authenticated writes.
 *
 * On a 401 the client makes exactly one silent refresh attempt and then gives up,
 * so a dead session cannot cause a refresh loop.
 */

/**
 * Root of the API.
 *
 * In development the Vite server proxies /api to the local API, so this is a
 * relative path and the browser sees one origin. In production the client and
 * API are on different sites (Cloudflare Pages and Render), so the build must
 * be given VITE_API_BASE_URL, e.g. https://speaking-coach-api.onrender.com/api.
 *
 * A relative default is deliberate: it keeps same-origin deployments working
 * with no configuration at all.
 */
const API_ROOT = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/+$/, '');

/** Absolute URL for an API path, always beginning with a single slash. */
export function apiUrl(path: string): string {
  return `${API_ROOT}${path.startsWith('/') ? path : `/${path}`}`;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: Record<string, string> | undefined;

  constructor(code: ErrorCode, status: number, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Set when this call is itself the refresh attempt. */
  isRetry?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: options.method ?? 'GET',
    credentials: 'include',
    signal: options.signal,
    headers: {
      'content-type': 'application/json',
      'x-sc-client': 'web',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const body = payload as {
      error?: { code?: ErrorCode; message?: string; fields?: Record<string, string> };
    } | null;
    const code: ErrorCode = body?.error?.code ?? 'internal_error';
    const message = body?.error?.message ?? 'Something went wrong. Please try again.';

    // One silent refresh, then give up. The retry is flagged so a dead session
    // cannot bounce between refresh and the original request forever.
    if (response.status === 401 && !options.isRetry && path !== '/auth/refresh') {
      try {
        await request<unknown>('/auth/refresh', { method: 'POST', isRetry: true });
        return await request<T>(path, { ...options, isRetry: true });
      } catch {
        // The session is gone for good; report the original 401 below.
      }
    }

    throw new ApiError(code, response.status, message, body?.error?.fields);
  }

  return payload as T;
}

// --- view models, mirroring the API responses ---------------------------------

export interface Account {
  userId: string;
  email: string;
  displayName: string;
  createdAt: string;
  profile: {
    nativeLanguage: string;
    nativeLanguageScript: string;
    targetRole: string;
    targetDomain: string;
    confidenceMode: boolean;
    captionsAlwaysOn: boolean;
    onboardedAt: string | null;
  } | null;
}

export interface ProviderHealthView {
  id: string;
  kind: ProviderKind;
  status: 'ok' | 'unconfigured' | 'unreachable' | 'rejected' | 'limited' | 'unknown';
  detail: string;
  latencyMs: number | null;
  checkedAt: string;
  rateLimitHeaders: Record<string, string> | null;
  deep: boolean;
  configured: boolean;
  /** -1 when the provider is not part of any chain. */
  chainPosition: number;
  capabilities: ProviderCapabilities | null;
  freeTier: (FreeQuota & { source: string; verifiedOn: string; notes?: string }) | null;
  documentation: { title: string; url: string }[];
}

export interface ProvidersResponse {
  checkedAt: string;
  deep: boolean;
  capabilities: { wordTimestamps: boolean; streaming: boolean; pronunciationScoring: boolean };
  chains: Record<string, string[]>;
  providers: ProviderHealthView[];
  pronunciation: { available: boolean; uiLabel: string; reason: string };
}

export interface LimitStatus extends FreeQuotaLimit {
  used: number;
  remaining: number;
  percentUsed: number;
  exhausted: boolean;
}
export interface UsageToday {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  audioSeconds: number;
  characters: number;
  neurons: number;
  errors: number;
  quotaBlocks: number;
}

export interface BudgetProvider {
  providerId: string;
  kind: ProviderKind;
  configured: boolean;
  configurationHint: string | null;
  position: number;
  limits: LimitStatus[];
  breaker: { state: 'closed' | 'open' | 'half_open'; retryAt: number | null };
  usageToday: UsageToday | null;
}

export interface CapacityLine {
  providerId: string;
  dailyAllowanceSeconds: number;
  dailyAllowanceTokens: number;
  learnersServableAtAssumedUsage: number | null;
  basis: string;
}

export interface BudgetResponse {
  generatedAt: string;
  dayKey: string;
  available: Record<ProviderKind, boolean>;
  totals: Record<string, number>;
  providers: BudgetProvider[];
  /** Read back from the database, so it survives a restart unlike the rolling ledger. */
  durableToday: Record<string, UsageToday>;
  notes: {
    assumptions: Record<string, number>;
    tokensPerLearnerPerDay: number;
    lines: CapacityLine[];
    headline: string;
    growthPaths: string[];
    honesty: string;
  };
}

// --- endpoints ---------------------------------------------------------------

export const api = {
  register(input: {
    email: string;
    password: string;
    displayName?: string;
    nativeLanguage?: string;
    acceptedTerms: true;
  }) {
    return request<{ account: Account }>('/auth/register', { method: 'POST', body: input });
  },

  login(input: { email: string; password: string }) {
    return request<{ account: Account }>('/auth/login', { method: 'POST', body: input });
  },

  me() {
    return request<{ account: Account | null }>('/auth/me');
  },

  refresh() {
    return request<{ account: Account }>('/auth/refresh', { method: 'POST' });
  },

  async logout() {
    await request<{ ok: true }>('/auth/logout', { method: 'POST' });
  },

  forgotPassword(email: string) {
    return request<{ ok: true; delivery: string; devResetUrl?: string }>('/auth/forgot-password', {
      method: 'POST',
      body: { email },
    });
  },

  providers() {
    return request<ProvidersResponse>('/health/providers');
  },

  budget() {
    return request<BudgetResponse>('/health/budget');
  },
};

export function describeLimit(unit: QuotaUnit, window: QuotaWindow): string {
  const unitLabel: Record<QuotaUnit, string> = {
    requests: 'requests',
    input_tokens: 'input tokens',
    output_tokens: 'output tokens',
    total_tokens: 'tokens',
    characters: 'characters',
    audio_seconds: 'audio seconds',
    audio_minutes: 'audio minutes',
    neurons: 'neurons',
    concurrent_sessions: 'concurrent sessions',
  };
  const windowLabel: Record<QuotaWindow, string> = {
    second: 'per second',
    minute: 'per minute',
    hour: 'per hour',
    day: 'per day',
    month: 'per month',
  };
  return `${unitLabel[unit]} ${windowLabel[window]}`;
}
