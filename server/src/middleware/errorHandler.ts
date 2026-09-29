import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { safeMessageFor, type ErrorCode } from '@speaking-coach/shared';
import { AppError, statusForCode } from '../errors';
import { logger } from '../logging';

/**
 * Central error handler.
 *
 * AppErrors carry a message that is safe to show. Everything else is treated as a
 * bug: it is logged with its stack and answered with a generic message, so no
 * stack trace, SQL/Mongo detail or provider message can leak to a learner.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  let code: ErrorCode = 'internal_error';
  let message = safeMessageFor('internal_error');
  let status = statusForCode('internal_error');
  let fields: Record<string, string> | undefined;

  if (error instanceof AppError) {
    code = error.code;
    message = error.message;
    status = error.status;
    fields = error.fields;
    if (error.context) logger.warn({ requestId: req.requestId, ...error.context }, 'Request rejected');
  } else if (isBodyParseError(error)) {
    code = 'bad_request';
    message = safeMessageFor('bad_request');
    status = statusForCode(code);
  } else {
    logger.error(
      { requestId: req.requestId, path: req.path, method: req.method, err: error },
      'Unhandled error',
    );
  }

  res.status(status).json({
    error: {
      code,
      message,
      ...(fields ? { fields } : {}),
      requestId: req.requestId,
    },
  });
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError('not_found', { message: `No route matches ${req.method} ${req.path}.` }));
}

function isBodyParseError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error as { type?: string }).type === 'entity.parse.failed'
  );
}

/** Convenience for handlers that want to throw an AppError inline. */
export function fail(code: ErrorCode, message?: string, fields?: Record<string, string>): never {
  throw new AppError(code, { message, fields });
}

export type { RequestHandler };
