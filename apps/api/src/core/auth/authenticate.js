import { API_PREFIX } from '../../config/constants.js';
import {
  PasswordChangeRequiredError,
  SessionExpiredError,
  UnauthenticatedError,
} from '../errors/index.js';
import { GUARD, tagGuard } from '../authz/routeGuards.js';
import { buildUserActor } from './actor.js';
import { findSessionUser } from './sessions.js';
import { verifyAccessToken } from './tokens.js';

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The only routes a user with `must_change_password` may call (FR-002). */
const ALLOWED_DURING_PASSWORD_CHANGE = new Set([
  `GET ${API_PREFIX}/auth/me`,
  `POST ${API_PREFIX}/auth/change-password`,
  `POST ${API_PREFIX}/auth/logout`,
]);

/**
 * 403 PASSWORD_CHANGE_REQUIRED for every route but the three above while the actor must change
 * their password. Matched on the route definition (base URL + route path), not the raw URL.
 * @type {import('express').RequestHandler}
 */
export function requirePasswordChanged(req, _res, next) {
  if (!req.actor?.mustChangePassword) return next();
  const route = `${req.method} ${req.baseUrl}${req.route?.path ?? ''}`;
  next(ALLOWED_DURING_PASSWORD_CHANGE.has(route) ? undefined : new PasswordChangeRequiredError());
}

/**
 * Verifies the Bearer access token, reloads the user (status, token_version, role) and sets a
 * frozen `req.actor`. Suspended/left users and bumped token versions are rejected on the next
 * request (FR-003). Then applies `requirePasswordChanged`, so the gate is on every
 * authenticated route.
 * @type {import('express').RequestHandler}
 */
async function authenticateRequest(req, res, next) {
  const header = req.get('authorization');
  if (!header) throw new UnauthenticatedError();
  const token = header.match(BEARER)?.[1];
  if (!token) throw new SessionExpiredError();

  const claims = await verifyAccessToken(token);
  if (!UUID.test(claims.sub)) throw new SessionExpiredError();

  const user = await findSessionUser(claims.sub);
  if (
    !user ||
    user.status !== 'active' ||
    user.tokenVersion !== claims.tv ||
    user.agencyId !== claims.agencyId
  ) {
    throw new SessionExpiredError();
  }

  req.actor = buildUserActor(user);
  requirePasswordChanged(req, res, next);
}

export const authenticate = tagGuard(authenticateRequest, GUARD.AUTHENTICATE);
