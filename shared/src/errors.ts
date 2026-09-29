/**
 * Error codes shared by the API and the client.
 *
 * Codes are stable strings so the client can react to a specific situation
 * (quota exhausted, mic permission missing, provider unavailable) without parsing
 * English text. Anything not listed here is reported to the client as
 * `internal_error` with no detail, so stack traces and provider messages never leak.
 */

export const ERROR_CODES = [
  'bad_request',
  'validation_failed',
  'unauthorized',
  'invalid_credentials',
  'email_taken',
  'forbidden',
  'not_found',
  'rate_limited',
  'password_weak',
  'token_expired',
  'token_invalid',
  'quota_exhausted',
  'provider_unavailable',
  'fair_use_limit_reached',
  'unsupported_capability',
  'internal_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    /** Safe, plain-language message suitable for display. */
    message: string;
    /** Field-level messages for form UIs. */
    fields?: Record<string, string>;
    requestId?: string;
  };
}

const SAFE_DEFAULTS: Record<ErrorCode, string> = {
  bad_request: 'That request could not be understood.',
  validation_failed: 'Please check the highlighted fields.',
  unauthorized: 'Please sign in to continue.',
  invalid_credentials: 'That email and password do not match.',
  email_taken: 'An account already exists with that email.',
  forbidden: 'You do not have access to that.',
  not_found: 'We could not find that.',
  rate_limited: 'Too many attempts. Please wait a moment and try again.',
  password_weak: 'That password is too easy to guess.',
  token_expired: 'That link or session has expired. Please start again.',
  token_invalid: 'That link or session is not valid.',
  quota_exhausted: 'Our shared free capacity is used up for now. Please try again later.',
  provider_unavailable: 'That service is not available right now.',
  fair_use_limit_reached: 'You have reached today\'s practice goal.',
  unsupported_capability: 'That feature is not available on the current setup.',
  internal_error: 'Something went wrong on our side. Please try again.',
};

export function safeMessageFor(code: ErrorCode): string {
  return SAFE_DEFAULTS[code];
}
