/**
 * HTTP helper for provider calls.
 *
 * Adds the things every upstream call needs: a hard timeout, retries for
 * transient failures only (never for 429, which the Quota Governor owns), and
 * extraction of rate-limit headers so our ledger can be corrected by the
 * provider's own numbers instead of our guesses.
 */

import { logger } from '../logging';

const RATE_LIMIT_HEADER_PATTERN = /^(x-ratelimit|ratelimit|x-ratelimit-requests|x-request-id)/i;

export interface ProviderCallOptions {
  providerId: string;
  timeoutMs?: number;
  /** Additional attempts for network errors and 5xx responses. */
  retries?: number;
  /** Abort signal from the caller, combined with the timeout. */
  signal?: AbortSignal | undefined;
}

export interface ProviderResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
  bytes: Buffer | null;
  latencyMs: number;
  rateLimitHeaders: Record<string, string>;
}

export class ProviderHttpError extends Error {
  readonly providerId: string;
  readonly status: number;
  readonly bodyText: string;
  readonly rateLimitHeaders: Record<string, string>;
  readonly retryAfterMs: number | null;

  constructor(params: {
    providerId: string;
    status: number;
    bodyText: string;
    rateLimitHeaders: Record<string, string>;
    message: string;
  }) {
    super(params.message);
    this.name = 'ProviderHttpError';
    this.providerId = params.providerId;
    this.status = params.status;
    this.bodyText = params.bodyText;
    this.rateLimitHeaders = params.rateLimitHeaders;
    this.retryAfterMs = parseRetryAfter(params.rateLimitHeaders['retry-after']);
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isAuthRejected(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isRetryable(): boolean {
    return this.status === 408 || this.status === 500 || this.status === 502 || this.status === 503;
  }
}

export function collectRateLimitHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (RATE_LIMIT_HEADER_PATTERN.test(lower) || lower === 'retry-after') {
      result[lower] = value;
    }
  });
  return result;
}

export function parseRetryAfter(value: string | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function combineSignals(timeoutMs: number, external?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Provider timeout after ${timeoutMs}ms`)), timeoutMs);
  const onAbort = (): void => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) onAbort();
    else external.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    },
  };
}

export async function providerRequest(
  url: string,
  init: RequestInit,
  options: ProviderCallOptions,
): Promise<ProviderResponse> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxAttempts = Math.max(1, (options.retries ?? 1) + 1);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const started = Date.now();
    const { signal, dispose } = combineSignals(timeoutMs, options.signal);
    try {
      const response = await fetch(url, { ...init, signal });
      const bytes = Buffer.from(await response.arrayBuffer());
      const latencyMs = Date.now() - started;
      const rateLimitHeaders = collectRateLimitHeaders(response.headers);
      const text = bytes.toString('utf8');

      if (response.status === 429 || response.status >= 500) {
        throw new ProviderHttpError({
          providerId: options.providerId,
          status: response.status,
          bodyText: text,
          rateLimitHeaders,
          message: `${options.providerId} responded ${response.status}`,
        });
      }
      if (!response.ok) {
        throw new ProviderHttpError({
          providerId: options.providerId,
          status: response.status,
          bodyText: text,
          rateLimitHeaders,
          message: `${options.providerId} responded ${response.status}`,
        });
      }

      return {
        status: response.status,
        ok: true,
        headers: response.headers,
        text,
        bytes,
        latencyMs,
        rateLimitHeaders,
      };
    } catch (error) {
      lastError = error;
      const isHttpError = error instanceof ProviderHttpError;
      const shouldRetry =
        attempt < maxAttempts && (!isHttpError || (isHttpError && error.isRetryable));
      if (!shouldRetry) throw error;
      const backoff = 250 * 2 ** (attempt - 1);
      logger.warn(
        { providerId: options.providerId, attempt, backoffMs: backoff, err: error },
        'Retrying provider call',
      );
      await sleep(backoff);
    } finally {
      dispose();
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${options.providerId} request failed`);
}

/** Parse a JSON body, turning a malformed response into a clear provider error. */
export function parseJson<T>(response: ProviderResponse, providerId: string): T {
  try {
    return JSON.parse(response.text) as T;
  } catch {
    throw new ProviderHttpError({
      providerId,
      status: response.status,
      bodyText: response.text.slice(0, 200),
      rateLimitHeaders: response.rateLimitHeaders,
      message: `${providerId} returned a response that was not JSON`,
    });
  }
}
