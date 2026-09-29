import cors from 'cors';
import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { env } from '../env';

/**
 * Security middleware.
 *
 * CORS is an explicit allowlist with credentials enabled, because we authenticate
 * with cookies. Rate limits are per IP for anonymous traffic and per user id once
 * we know who is calling, so one noisy network cannot spend everyone else's quota.
 */

export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", ...env().CORS_ORIGINS],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
}

export function corsAllowlist(): RequestHandler {
  const allowed = new Set(env().CORS_ORIGINS);
  return cors({
    origin(origin, callback) {
      // No Origin header means a same-origin request or a non-browser client.
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, allowed.has(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-sc-client', 'x-request-id', 'last-event-id'],
    exposedHeaders: ['x-request-id', 'x-ratelimit-remaining'],
    maxAge: 600,
  });
}

function keyGeneratorByUserId(req: { auth?: { userId: string } } & { ip?: string }): string {
  return req.auth?.userId ?? `ip:${req.ip ?? 'unknown'}`;
}

export const authRateLimit: RequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env().RATE_LIMIT_AUTH_PER_15_MIN,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `ip:${req.ip ?? 'unknown'}`,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Too many attempts. Please wait a few minutes and try again.',
    },
  },
});

export const apiRateLimit: RequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: env().RATE_LIMIT_API_PER_MIN,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const withAuth = req as typeof req & { auth?: { userId: string } };
    return keyGeneratorByUserId(withAuth);
  },
  message: {
    error: {
      code: 'rate_limited',
      message: 'You are sending requests too quickly. Please slow down a little.',
    },
  },
});
