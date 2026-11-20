import { ValidationError } from '../errors/index.js';

const LOCATIONS = /** @type {const} */ (['params', 'query', 'body']);

/**
 * Validates `req.params`, `req.query` and `req.body` against Zod schemas and replaces them with the
 * parsed values. All issues from all locations are reported together as a 400 VALIDATION_FAILED,
 * with `details` = `[{ path: 'body.name', message }]`.
 *
 * @param {{ body?: import('zod').ZodType, params?: import('zod').ZodType, query?: import('zod').ZodType }} schemas
 * @returns {import('express').RequestHandler}
 */
export function validate(schemas) {
  return (req, _res, next) => {
    const details = [];
    const parsed = {};

    for (const location of LOCATIONS) {
      const schema = schemas[location];
      if (!schema) continue;
      const result = schema.safeParse(req[location] ?? {});
      if (result.success) {
        parsed[location] = result.data;
      } else {
        for (const issue of result.error.issues) {
          details.push({ path: [location, ...issue.path].join('.'), message: issue.message });
        }
      }
    }

    if (details.length > 0) return next(new ValidationError(details));

    for (const [location, value] of Object.entries(parsed)) {
      // Express 5 exposes req.query as a getter, so it is redefined rather than assigned.
      Object.defineProperty(req, location, {
        value,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    next();
  };
}
