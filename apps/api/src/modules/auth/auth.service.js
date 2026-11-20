// FR-001 login · FR-002 forced password change · FR-003 session revocation. Every write runs in one
// transaction together with its audit row. Never touches req/res: callers pass a request context.
import { passwordPolicyViolations, permissionsFor } from '@fieldflow/shared';
import { logger } from '../../config/logger.js';
import { auditService, hashEmail } from '../../core/audit/index.js';
import {
  generateRefreshToken,
  hashPassword,
  hashRefreshToken,
  refreshTokenExpiry,
  revokeAllSessions,
  signAccessToken,
  tokenHashesEqual,
  verifyDummyPassword,
  verifyPassword,
} from '../../core/auth/index.js';
import {
  CurrentPasswordIncorrectError,
  InvalidCredentialsError,
  RefreshTokenReusedError,
  SessionExpiredError,
  WeakPasswordError,
} from '../../core/errors/index.js';
import { clock } from '../../core/time/clock.js';
import { withTransaction } from '../../db/transaction.js';
import * as repository from './auth.repository.js';
import { AUTH_ACTIONS } from './auth.events.js';

/**
 * @typedef {object} RequestContext
 * @property {string | null} ip
 * @property {string} id request id
 * @property {string | null} userAgent
 */

/**
 * @typedef {object} AuthResult
 * @property {string} accessToken
 * @property {number} expiresIn seconds
 * @property {object} user row without the password hash
 * @property {{ token: string, expiresAt: Date }} refresh the new refresh token (cookie value)
 */

const USER_ACTOR = (user) => ({ type: 'user', id: user.id, agencyId: user.agencyId });
const SYSTEM = { type: 'system', id: null };

/** Issues a refresh token in `familyId` (or a new family) and returns its raw value. */
async function issueRefreshToken(tx, user, ctx, familyId) {
  const token = generateRefreshToken();
  const expiresAt = refreshTokenExpiry();
  const row = await repository.createRefreshToken(tx, {
    agencyId: user.agencyId,
    userId: user.id,
    familyId,
    tokenHash: hashRefreshToken(token),
    expiresAt,
    ip: ctx.ip,
    userAgent: ctx.userAgent?.slice(0, 512) ?? null,
  });
  return { token, expiresAt, id: row.id };
}

/** @returns {Promise<Omit<AuthResult, 'refresh'>>} */
async function sessionFor(user) {
  const { accessToken, expiresIn } = await signAccessToken(user);
  return { accessToken, expiresIn, user };
}

/**
 * Email + password login. Unknown email, wrong password and suspended/left accounts all end in the
 * same 401 INVALID_CREDENTIALS after a full argon2 verification (no enumeration by body or timing).
 * @param {{ email: string, password: string }} credentials email already normalised
 * @param {RequestContext} ctx
 * @returns {Promise<AuthResult>}
 */
export async function login({ email, password }, ctx) {
  const user = await repository.findUserForLogin(email);
  if (!user) {
    await verifyDummyPassword(password);
    // audit_logs needs an agency and an entity id, which an unknown email does not have.
    logger.warn(
      { event: AUTH_ACTIONS.LOGIN_FAILED, emailHash: hashEmail(email), requestId: ctx.id },
      'Login failed: unknown email',
    );
    throw new InvalidCredentialsError();
  }

  const { passwordHash, ...account } = user;
  const passwordOk = await verifyPassword(passwordHash, password);
  if (!passwordOk || account.status !== 'active') {
    await withTransaction((tx) =>
      auditService.record(tx, {
        actor: SYSTEM,
        agencyId: account.agencyId,
        action: AUTH_ACTIONS.LOGIN_FAILED,
        entityType: 'user',
        entityId: account.id,
        after: {
          emailHash: hashEmail(email),
          reason: passwordOk ? `account_${account.status}` : 'wrong_password',
        },
        req: ctx,
      }),
    );
    throw new InvalidCredentialsError();
  }

  const refresh = await withTransaction(async (tx) => {
    const issued = await issueRefreshToken(tx, account, ctx);
    await repository.markLoggedIn(tx, account.id, clock.now());
    await auditService.record(tx, {
      actor: USER_ACTOR(account),
      action: AUTH_ACTIONS.LOGIN_SUCCEEDED,
      entityType: 'user',
      entityId: account.id,
      req: ctx,
    });
    return issued;
  });

  return { ...(await sessionFor(account)), refresh };
}

/**
 * Rotates a refresh token: the presented token is revoked and replaced by a new one in the same
 * family. Presenting a token that was already rotated means it leaked: the whole family is revoked,
 * the event audited, and the call fails with REFRESH_TOKEN_REUSED.
 * @param {string | undefined} rawToken value of the ff_rt cookie
 * @param {RequestContext} ctx
 * @returns {Promise<AuthResult>}
 */
export async function refresh(rawToken, ctx) {
  if (typeof rawToken !== 'string' || rawToken.length === 0 || rawToken.length > 256) {
    throw new SessionExpiredError();
  }
  const tokenHash = hashRefreshToken(rawToken);
  const now = clock.now();

  const outcome = await withTransaction(async (tx) => {
    const stored = await repository.lockRefreshTokenByHash(tx, tokenHash);
    if (!stored || !tokenHashesEqual(stored.tokenHash, tokenHash)) return { error: 'expired' };

    if (stored.revokedAt) {
      // Revoked without a successor = ended by logout / revokeAllSessions: just expired.
      if (!stored.replacedById) return { error: 'expired' };
      await repository.revokeRefreshTokenFamily(tx, stored.familyId, now);
      await auditService.record(tx, {
        actor: SYSTEM,
        agencyId: stored.agencyId,
        action: AUTH_ACTIONS.REFRESH_REUSE_DETECTED,
        entityType: 'user',
        entityId: stored.userId,
        after: { familyId: stored.familyId, refreshTokenId: stored.id },
        req: ctx,
      });
      return { error: 'reused' };
    }

    if (stored.expiresAt <= now) {
      await repository.revokeRefreshToken(tx, stored.id, now);
      return { error: 'expired' };
    }

    const user = await repository.findUserById(stored.userId, tx);
    if (!user || user.status !== 'active') {
      await repository.revokeRefreshToken(tx, stored.id, now);
      return { error: 'expired' };
    }

    const issued = await issueRefreshToken(tx, user, ctx, stored.familyId);
    await repository.revokeRefreshToken(tx, stored.id, now, issued.id);
    return { user, refresh: issued };
  });

  // Thrown after the transaction so the family revocation and its audit row are committed.
  if (outcome.error === 'reused') throw new RefreshTokenReusedError();
  if (outcome.error) throw new SessionExpiredError();
  return { ...(await sessionFor(outcome.user)), refresh: outcome.refresh };
}

/**
 * Revokes the refresh token of this browser (if it belongs to the actor and is active).
 * @param {import('../../core/auth/actor.js').UserActor} actor
 * @param {string | undefined} rawToken
 * @param {RequestContext} ctx
 */
export async function logout(actor, rawToken, ctx) {
  await withTransaction(async (tx) => {
    if (typeof rawToken === 'string' && rawToken.length > 0 && rawToken.length <= 256) {
      await repository.revokeActiveUserToken(tx, actor.id, hashRefreshToken(rawToken), clock.now());
    }
    await auditService.record(tx, {
      actor,
      action: AUTH_ACTIONS.LOGOUT,
      entityType: 'user',
      entityId: actor.id,
      after: { allSessions: false },
      req: ctx,
    });
  });
}

/**
 * Ends every session of the actor on every device.
 * @param {import('../../core/auth/actor.js').UserActor} actor
 * @param {RequestContext} ctx
 */
export async function logoutAll(actor, ctx) {
  await withTransaction(async (tx) => {
    await revokeAllSessions(tx, actor.id);
    await auditService.record(tx, {
      actor,
      action: AUTH_ACTIONS.LOGOUT,
      entityType: 'user',
      entityId: actor.id,
      after: { allSessions: true },
      req: ctx,
    });
  });
}

/**
 * Checks the current password and the policy, stores the new hash, clears must_change_password,
 * revokes every session (token_version bump) and starts a new one for this browser.
 * @param {import('../../core/auth/actor.js').UserActor} actor
 * @param {{ currentPassword: string, newPassword: string }} input
 * @param {RequestContext} ctx
 * @returns {Promise<AuthResult>}
 */
export async function changePassword(actor, { currentPassword, newPassword }, ctx) {
  const account = await repository.findUserWithPasswordHash(actor.id);
  if (!account || !(await verifyPassword(account.passwordHash, currentPassword))) {
    throw new CurrentPasswordIncorrectError();
  }

  const violations = passwordPolicyViolations(newPassword);
  if (newPassword === currentPassword) violations.push('same_as_current');
  if (violations.length > 0) {
    throw new WeakPasswordError(
      violations.map((rule) => ({ path: 'body.newPassword', message: rule })),
    );
  }

  const newHash = await hashPassword(newPassword);
  const result = await withTransaction(async (tx) => {
    await repository.updatePassword(tx, actor.id, newHash);
    await revokeAllSessions(tx, actor.id);
    const user = await repository.findUserById(actor.id, tx);
    const issued = await issueRefreshToken(tx, user, ctx);
    await auditService.record(tx, {
      actor,
      action: AUTH_ACTIONS.PASSWORD_CHANGED,
      entityType: 'user',
      entityId: actor.id,
      before: { mustChangePassword: account.mustChangePassword },
      after: { mustChangePassword: false, otherSessionsRevoked: true },
      req: ctx,
    });
    return { user, refresh: issued };
  });

  return { ...(await sessionFor(result.user)), refresh: result.refresh };
}

/**
 * The signed-in user and the permissions of their role.
 * @param {import('../../core/auth/actor.js').UserActor} actor
 */
export async function me(actor) {
  const user = await repository.findUserById(actor.id);
  if (!user) throw new SessionExpiredError();
  return { user, permissions: permissionsFor(user.role) };
}
