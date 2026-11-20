import { prisma } from '../../db/client.js';
import { clock } from '../time/clock.js';

/** Columns `authenticate` needs: one primary-key lookup per request. */
const SESSION_USER_SELECT = Object.freeze({
  id: true,
  agencyId: true,
  role: true,
  clientId: true,
  status: true,
  tokenVersion: true,
  mustChangePassword: true,
});

/** @param {string} userId */
export function findSessionUser(userId, db = prisma) {
  return db.user.findUnique({ where: { id: userId }, select: SESSION_USER_SELECT });
}

/**
 * Ends every session of a user: bumps `token_version` (existing access tokens fail on their next
 * request) and revokes all refresh tokens. Run it inside the caller's transaction.
 * Used by change-password, logout-all and (Prompt 04) user suspension.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} userId
 * @returns {Promise<number>} the new token_version
 */
export async function revokeAllSessions(tx, userId) {
  const { tokenVersion } = await tx.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
    select: { tokenVersion: true },
  });
  await tx.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: clock.now() },
  });
  return tokenVersion;
}
