// Writes audit_logs rows with the caller's transaction client, so the audit row commits or rolls
// back together with the change it describes. audit_logs is append-only (DB trigger, BR-40).
import { createHash } from 'node:crypto';

/**
 * Keys never written to before/after, at any depth: passwords and their hashes, secrets, tokens and
 * token hashes. Flags such as `mustChangePassword` or `tokenVersion` are kept.
 */
const SECRET_KEY =
  /^(password|password_?hash|(current|new|old|temporary)_?password)$|secret|token$|token_?hash$|^cookie$|^authorization$/i;
const ACTOR_TYPES = new Set(['user', 'system', 'ai_service']);

/**
 * Deep copy without secret keys; Dates become ISO strings.
 * @param {unknown} value
 * @returns {unknown}
 */
export function redactSecrets(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SECRET_KEY.test(key))
        .map(([key, child]) => [key, redactSecrets(child)]),
    );
  }
  return value;
}

/**
 * Identifies an email in audit rows without storing it (e.g. failed logins).
 * @param {string} email already normalised (trimmed, lower-cased)
 */
export function hashEmail(email) {
  return createHash('sha256').update(email, 'utf8').digest('hex');
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {object} entry
 * @param {{ type: 'user' | 'system' | 'ai_service', id: string | null, agencyId?: string }} entry.actor
 * @param {string} entry.action e.g. `auth.login_succeeded`
 * @param {string} entry.entityType e.g. `user`
 * @param {string} entry.entityId uuid
 * @param {string} [entry.agencyId] defaults to the actor's agency (required for system actors)
 * @param {unknown} [entry.before]
 * @param {unknown} [entry.after]
 * @param {import('express').Request} [entry.req] source of ip and request id
 */
export async function record(
  tx,
  { actor, action, entityType, entityId, agencyId, before, after, req },
) {
  if (!actor || !ACTOR_TYPES.has(actor.type)) throw new Error('audit: unknown actor type');
  const agency = agencyId ?? actor.agencyId;
  if (!agency) throw new Error('audit: agencyId is required');

  return tx.auditLog.create({
    data: {
      agencyId: agency,
      actorType: actor.type,
      actorId: actor.type === 'user' ? actor.id : null,
      action,
      entityType,
      entityId,
      before: before === undefined ? undefined : redactSecrets(before),
      after: after === undefined ? undefined : redactSecrets(after),
      ip: req?.ip ?? null,
      requestId: req?.id ?? null,
    },
    select: { id: true },
  });
}

export const auditService = Object.freeze({ record });
