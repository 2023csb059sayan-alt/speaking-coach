import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import { env } from './env';
import { requestId } from './middleware/requestId';
import { requireClientHeader } from './middleware/auth';
import { corsAllowlist, securityHeaders } from './middleware/security';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { authRouter } from './routes/auth';
import { healthRouter } from './routes/health';
import { keysRouter } from './routes/keys';
import { runScheduledProbes } from './services/probes';

/**
 * The Express application.
 *
 * Kept separate from the server bootstrap so tests can mount it without opening a
 * port, and so a broken environment fails at import time in one obvious place.
 */

export function createApp(): Express {
  const app = express();

  // Behind Render or any other proxy, trust the first hop so rate limiting keys off
  // the real client address rather than the proxy's.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(securityHeaders());
  app.use(corsAllowlist());
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  // Cookie-authenticated writes must carry a header a cross-site page cannot set.
  app.use(requireClientHeader);

  app.get('/', (_req, res) => {
    res.json({
      name: 'speaking-coach-api',
      phase: 1,
      docs: '/api/health/live, /api/health/ready, /api/health/providers, /api/health/budget',
    });
  });

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/keys', keysRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  // Scheduled provider probes only run in the long-lived server process.
  if (env().NODE_ENV !== 'test') {
    void runScheduledProbes({
      intervalMinutes: env().PROBE_INTERVAL_MINUTES,
      deep: env().DEEP_PROBE,
    });
  }

  return app;
}
