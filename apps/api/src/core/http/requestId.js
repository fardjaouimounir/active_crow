import { randomUUID } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Reuses a well-formed incoming X-Request-Id (UUID) or generates one, exposes it as `req.id`
 * and echoes it in the response header. Anything that is not a UUID is ignored to avoid log injection.
 * @type {import('express').RequestHandler}
 */
export function requestId(req, res, next) {
  const incoming = req.get(REQUEST_ID_HEADER);
  const id = incoming && UUID_PATTERN.test(incoming) ? incoming.toLowerCase() : randomUUID();
  req.id = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}
