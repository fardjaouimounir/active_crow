import { INTERNAL_ERROR, VALIDATION_FAILED } from '@fieldflow/shared';
import { logger } from '../../config/logger.js';
import { AppError } from './AppError.js';
import { NotFoundError } from './httpErrors.js';

const GENERIC_MESSAGE = 'An unexpected error occurred';

/**
 * Maps errors raised by Express' own body parser to client errors.
 * @param {any} err
 * @returns {AppError | null}
 */
function fromBodyParser(err) {
  if (err?.type === 'entity.parse.failed') {
    return new AppError({ status: 400, code: VALIDATION_FAILED, message: 'Malformed JSON body' });
  }
  if (err?.type === 'entity.too.large') {
    return new AppError({
      status: 413,
      code: VALIDATION_FAILED,
      message: 'Request body is too large',
    });
  }
  return null;
}

/** Catch-all for unmatched routes. */
export function notFoundHandler(req, _res, next) {
  next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
}

/**
 * Central error handler: every error response has the shape
 * `{ error: { code, message, details?, requestId } }`. Unknown errors are logged with their stack
 * and returned as a generic 500 so no internals leak to the client.
 * @type {import('express').ErrorRequestHandler}
 */
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const known = err instanceof AppError ? err : fromBodyParser(err);
  const log = req.log ?? logger;

  if (!known) {
    log.error({ err, requestId: req.id }, 'Unhandled error');
  }

  const status = known?.status ?? 500;
  const body = {
    code: known?.code ?? INTERNAL_ERROR,
    message: known?.message ?? GENERIC_MESSAGE,
    ...(known?.details !== undefined && { details: known.details }),
    requestId: req.id,
  };

  res.status(status).json({ error: body });
}
