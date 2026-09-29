import pino from 'pino';

/**
 * Structured logging.
 *
 * Rules encoded here rather than left to discipline:
 *   - nothing in a log line may contain a transcript, an email address, a password,
 *     a token or an API key, so redaction is configured centrally;
 *   - pretty printing is on for local development and off everywhere else,
 *     including tests, so a logging worker can never hold the test process open.
 *
 * Logging config reads process.env directly instead of the validated Env object to
 * keep this module free of import cycles.
 */

const level = process.env.LOG_LEVEL ?? 'info';
const prettyEnabled =
  process.env.LOG_PRETTY !== 'false' && process.env.NODE_ENV !== 'production' && process.env.VITEST !== 'true';

export const logger = pino({
  level,
  base: undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'passwordHash',
      'token',
      'refreshToken',
      'apiKey',
      'secret',
      'encryptedSecret',
      'email',
      'transcript',
      'text',
    ],
    censor: '[redacted]',
  },
  transport: prettyEnabled
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      }
    : undefined,
});

export type Logger = typeof logger;
