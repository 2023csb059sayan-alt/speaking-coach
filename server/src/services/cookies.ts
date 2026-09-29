import type { CookieOptions, Response } from 'express';
import { env } from '../env';

/**
 * Cookie policy.
 *
 * Tokens live in httpOnly cookies so no JavaScript can read them, which is the
 * main defence against XSS. `SameSite` defaults to Lax; a client served from a
 * different site than the API needs SameSite=None plus Secure, and that is refused
 * outside production because it cannot work over plain HTTP.
 */

export const ACCESS_COOKIE = 'sc_at';
export const REFRESH_COOKIE = 'sc_rt';

function baseOptions(): CookieOptions {
  const config = env();
  const secure = config.NODE_ENV === 'production' || config.COOKIE_SAMESITE === 'none';
  return {
    httpOnly: true,
    secure,
    sameSite: config.COOKIE_SAMESITE,
    path: '/',
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  };
}

export function setAccessCookie(res: Response, token: string): void {
  const config = env();
  res.cookie(ACCESS_COOKIE, token, {
    ...baseOptions(),
    maxAge: config.ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
}

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...baseOptions(),
    expires: expiresAt,
  });
}

export function clearAuthCookies(res: Response): void {
  // Pass the same attributes the cookies were set with. Do not pass expires or
  // maxAge: Express merges the options after its own expiry value, so an explicit
  // undefined here would stop the cookie from actually being cleared.
  const options = baseOptions();
  res.clearCookie(ACCESS_COOKIE, options);
  res.clearCookie(REFRESH_COOKIE, options);
}
