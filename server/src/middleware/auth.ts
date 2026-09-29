import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../errors';
import { ACCESS_COOKIE } from '../services/cookies';
import { verifyAccessToken } from '../services/tokens';

/**
 * Authentication from the httpOnly access cookie.
 *
 * There is no token in localStorage and no bearer token in the URL, so the usual
 * XSS and link-leak paths do not exist. Mutating routes additionally require a
 * custom header (see requireClientHeader), which a cross-site form cannot set.
 */

function tokenFromRequest(req: Request): string | null {
  const cookies = req.cookies as Record<string, string> | undefined;
  const fromCookie = cookies?.[ACCESS_COOKIE];
  if (fromCookie) return fromCookie;
  return null;
}

export const requireAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = tokenFromRequest(req);
  if (!token) {
    next(new AppError('unauthorized'));
    return;
  }
  verifyAccessToken(token)
    .then((claims) => {
      req.auth = claims;
      next();
    })
    .catch(next);
};

/** Same check, but a missing session is not an error. Used by /auth/me. */
export const optionalAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = tokenFromRequest(req);
  if (!token) {
    next();
    return;
  }
  verifyAccessToken(token)
    .then((claims) => {
      req.auth = claims;
      next();
    })
    .catch(() => next());
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF mitigation for cookie-authenticated writes: a cross-origin page cannot send
 * a custom header without passing a CORS preflight, and our allowlist rejects any
 * origin that is not ours.
 */
export const requireClientHeader: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  if (req.header('x-sc-client') !== 'web') {
    next(new AppError('bad_request', { message: 'Missing client header on a state-changing request.' }));
    return;
  }
  next();
};
