import { safeMessageFor, type ErrorCode } from '@speaking-coach/shared';

/**
 * Application errors.
 *
 * Anything thrown as an AppError is safe to show a learner. Everything else is
 * treated as a bug: the central error handler logs it and returns a generic
 * `internal_error` with no detail, so stack traces and provider messages never
 * reach the client.
 */

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthorized: 401,
  invalid_credentials: 401,
  email_taken: 409,
  forbidden: 403,
  not_found: 404,
  rate_limited: 429,
  password_weak: 422,
  token_expired: 401,
  token_invalid: 400,
  quota_exhausted: 503,
  provider_unavailable: 503,
  fair_use_limit_reached: 429,
  unsupported_capability: 501,
  internal_error: 500,
};

export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: Record<string, string> | undefined;
  /** Extra context for the log line only. Never sent to the client. */
  readonly context: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    options: {
      message?: string;
      fields?: Record<string, string>;
      context?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? safeMessageFor(code), options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = statusForCode(code);
    this.fields = options.fields;
    this.context = options.context;
  }
}

/**
 * Every configured provider is out of budget or unavailable. This is the signal
 * the client turns into the honest "Practice mode is busy right now" screen rather
 * than a fake error.
 */
export class QuotaExhaustedError extends AppError {
  readonly providerIds: string[];

  constructor(providerIds: string[], detail: string) {
    super('quota_exhausted', { message: safeMessageFor('quota_exhausted'), context: { providerIds, detail } });
    this.name = 'QuotaExhaustedError';
    this.providerIds = providerIds;
  }
}
