import { VALIDATION_FAILED } from '@fieldflow/shared';
import { z } from 'zod';
import { AppError } from '../../core/errors/index.js';
import { validate } from '../../core/http/index.js';

export const params = z.strictObject({ id: z.uuid() });
export const empty = z.strictObject({});

export function validateBatch(schemas) {
  const middleware = validate(schemas);
  return (req, res, next) =>
    middleware(req, res, (err) => {
      if (err?.code !== VALIDATION_FAILED) return next(err);
      const groups = new Map();
      for (const detail of err.details) {
        const match = /^body\.(\d+)(?:\.|$)/.exec(detail.path);
        if (!match) return next(err);
        const index = Number(match[1]);
        if (!groups.has(index)) groups.set(index, []);
        groups.get(index).push(detail);
      }
      return next(
        new AppError({
          status: 400,
          code: err.code,
          message: err.message,
          details: {
            items: Array.from(groups, ([index, details]) => ({ index, code: err.code, details })),
          },
        }),
      );
    });
}
