// Idempotency for field-entry endpoints (CLAUDE.md §6). A request carries an `Idempotency-Key`
// (UUID). The key row is written in the SAME transaction as the business change, together with the
// response, so a retry either replays the stored response or (if the first attempt rolled back)
// runs again. A concurrent duplicate waits on the unique key until the first one commits.
import { createHash } from 'node:crypto';
import { ERROR_CODES, IDEMPOTENCY_HEADER } from '@fieldflow/shared';
import { z } from 'zod';
import { AppError } from '../errors/index.js';
import { clock } from '../time/clock.js';
import { withTransaction } from '../../db/transaction.js';

export const IDEMPOTENCY_TTL_MS = 48 * 60 * 60 * 1000;
const keySchema = z.uuid();

const canonical = (value) =>
  JSON.stringify(value, (_key, child) =>
    child && typeof child === 'object' && !Array.isArray(child)
      ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : child,
  );

/**
 * Requires a valid `Idempotency-Key` and fingerprints the request (method, URL, validated body and
 * any uploaded file). Mount it after `validate` and the upload middleware.
 * @type {import('express').RequestHandler}
 */
export function requireIdempotencyKey(req, _res, next) {
  const parsed = keySchema.safeParse(req.get(IDEMPOTENCY_HEADER));
  if (!parsed.success) {
    return next(
      new AppError({
        status: 400,
        code: ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED,
        message: `A ${IDEMPOTENCY_HEADER} header with a UUID is required`,
      }),
    );
  }
  const hash = createHash('sha256')
    .update(req.method + ' ' + req.originalUrl.split('?')[0] + '\n' + canonical(req.body ?? {}))
    .update(
      (req.files ?? (req.file ? [req.file] : []))
        .map((file) => createHash('sha256').update(file.buffer).digest('hex'))
        .join(''),
    )
    .digest('hex');
  req.idempotency = {
    key: parsed.data.toLowerCase(),
    endpoint: req.method + ' ' + req.baseUrl + (req.route?.path ?? ''),
    requestHash: hash,
  };
  next();
}

const reused = () =>
  new AppError({
    status: 422,
    code: ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
    message: 'This Idempotency-Key was already used for a different request',
  });

/**
 * Runs `work(tx)` once per key. The result becomes the response `{ data }` with `status`; a replay
 * returns the stored response unchanged.
 * @param {import('express').Request & { idempotency: { key: string, endpoint: string, requestHash: string } }} req
 * @param {(tx: object) => Promise<unknown>} work
 * @param {{ status?: number, transaction?: (fn: (tx: object) => Promise<any>) => Promise<any> }} [options]
 * @returns {Promise<{ status: number, body: { data: unknown }, replayed: boolean }>}
 */
export function runIdempotent(req, work, { status = 200, transaction = withTransaction } = {}) {
  const { key, endpoint, requestHash } = req.idempotency;
  const { id: userId, agencyId } = req.actor;
  const where = { userId_key: { userId, key } };
  return transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO idempotency_keys (user_id, key, agency_id, endpoint, request_hash, expires_at)
      VALUES (${userId}::uuid, ${key}, ${agencyId}::uuid, ${endpoint}, ${requestHash},
              ${new Date(clock.now().getTime() + IDEMPOTENCY_TTL_MS)})
      ON CONFLICT (user_id, key) DO NOTHING`;
    const [row] = await tx.$queryRaw`
      SELECT endpoint, request_hash, response_status, response_body, expires_at
      FROM idempotency_keys WHERE user_id = ${userId}::uuid AND key = ${key} FOR UPDATE`;
    const expired = row.expires_at.getTime() <= clock.now().getTime();
    if (!expired && (row.endpoint !== endpoint || row.request_hash !== requestHash)) throw reused();
    if (!expired && row.response_status !== null) {
      return { status: row.response_status, body: row.response_body, replayed: true };
    }
    const body = JSON.parse(JSON.stringify({ data: await work(tx) }));
    await tx.idempotencyKey.update({
      where,
      data: {
        endpoint,
        requestHash,
        responseStatus: status,
        responseBody: body,
        expiresAt: new Date(clock.now().getTime() + IDEMPOTENCY_TTL_MS),
      },
    });
    return { status, body, replayed: false };
  });
}

/** Sends the result of `runIdempotent` (`Idempotent-Replayed: true` on a replay). */
export function sendIdempotent(res, { status, body, replayed }) {
  if (replayed) res.set('Idempotent-Replayed', 'true');
  return res.status(status).json(body);
}

/** Daily job: removes keys older than their 48 h lifetime. */
export function cleanupIdempotencyKeys() {
  return withTransaction((tx) =>
    tx.idempotencyKey.deleteMany({ where: { expiresAt: { lt: clock.now() } } }),
  );
}
