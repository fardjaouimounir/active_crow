// Identity queries. Exception to "repositories take a scope": these run before an actor exists
// (login, refresh) or on the actor's own row, and always filter by the user's id or email hash.
import { randomUUID } from 'node:crypto';
import { prisma } from '../../db/client.js';

/** Fields returned to clients and used to sign tokens (never the password hash). */
const USER_SELECT = Object.freeze({
  id: true,
  agencyId: true,
  role: true,
  clientId: true,
  fullName: true,
  email: true,
  status: true,
  tokenVersion: true,
  mustChangePassword: true,
});

/** @param {string} email normalised; users.email is citext, so the match ignores case anyway */
export function findUserForLogin(email, db = prisma) {
  return db.user.findUnique({
    where: { email },
    select: { ...USER_SELECT, passwordHash: true },
  });
}

/** @param {string} id */
export function findUserById(id, db = prisma) {
  return db.user.findUnique({ where: { id }, select: USER_SELECT });
}

/** @param {string} id */
export function findUserWithPasswordHash(id, db = prisma) {
  return db.user.findUnique({ where: { id }, select: { ...USER_SELECT, passwordHash: true } });
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} userId
 * @param {Date} at
 */
export function markLoggedIn(tx, userId, at) {
  return tx.user.update({ where: { id: userId }, data: { lastLoginAt: at }, select: { id: true } });
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} userId
 * @param {string} passwordHash
 */
export function updatePassword(tx, userId, passwordHash) {
  return tx.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false },
    select: USER_SELECT,
  });
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ agencyId: string, userId: string, familyId?: string, tokenHash: string, expiresAt: Date, ip: string | null, userAgent: string | null }} data
 *   a new family is started when `familyId` is omitted
 */
export function createRefreshToken(tx, { familyId, ...data }) {
  return tx.refreshToken.create({
    data: { ...data, familyId: familyId ?? randomUUID() },
    select: { id: true, familyId: true },
  });
}

/**
 * Locks the refresh-token row with this hash for the rest of the transaction, so two concurrent
 * refreshes with the same token cannot both rotate it.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} tokenHash
 * @returns {Promise<{ id: string, agencyId: string, userId: string, familyId: string, tokenHash: string, expiresAt: Date, revokedAt: Date | null, replacedById: string | null } | null>}
 */
export async function lockRefreshTokenByHash(tx, tokenHash) {
  const rows = await tx.$queryRaw`
    SELECT id, agency_id AS "agencyId", user_id AS "userId", family_id AS "familyId", token_hash AS "tokenHash",
           expires_at AS "expiresAt", revoked_at AS "revokedAt", replaced_by_id AS "replacedById"
    FROM refresh_tokens
    WHERE token_hash = ${tokenHash}
    FOR UPDATE`;
  return rows[0] ?? null;
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} id
 * @param {Date} at
 * @param {string} [replacedById]
 */
export function revokeRefreshToken(tx, id, at, replacedById) {
  return tx.refreshToken.update({
    where: { id },
    data: { revokedAt: at, ...(replacedById && { replacedById }) },
    select: { id: true },
  });
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} familyId
 * @param {Date} at
 */
export function revokeRefreshTokenFamily(tx, familyId, at) {
  return tx.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: at },
  });
}

/**
 * Revokes the given token only if it belongs to `userId` and is still active (logout).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} userId
 * @param {string} tokenHash
 * @param {Date} at
 * @returns {Promise<number>} rows revoked (0 or 1)
 */
export async function revokeActiveUserToken(tx, userId, tokenHash, at) {
  const { count } = await tx.refreshToken.updateMany({
    where: { userId, tokenHash, revokedAt: null },
    data: { revokedAt: at },
  });
  return count;
}

/**
 * Deletes refresh tokens that expired before `before`. Expired tokens are useless for reuse
 * detection (an expired token is rejected anyway). Tokens still referenced by a newer, unexpired
 * row of their family (replaced_by_id) are kept until that row expires too.
 * Called by the `auth.cleanup-tokens` job once pg-boss exists.
 * @param {Date} before
 * @returns {Promise<number>} rows deleted
 */
export function deleteExpiredRefreshTokens(before, db = prisma) {
  return db.$executeRaw`
    DELETE FROM refresh_tokens t
    WHERE t.expires_at < ${before}
      AND NOT EXISTS (
        SELECT 1 FROM refresh_tokens r
        WHERE r.replaced_by_id = t.id AND r.expires_at >= ${before}
      )`;
}
