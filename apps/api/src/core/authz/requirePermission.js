import { can, isPermission } from '@fieldflow/shared';
import { ForbiddenError, UnauthenticatedError } from '../errors/index.js';
import { GUARD, tagGuard } from './routeGuards.js';

/**
 * Route guard: the actor's role must hold **every** listed permission (catalog in
 * @fieldflow/shared/permissions), otherwise 403 FORBIDDEN. Must come after `authenticate`.
 * Unknown permission names fail at startup, not at request time.
 * @param {...string} permissions
 * @returns {import('express').RequestHandler}
 */
export function requirePermission(...permissions) {
  if (permissions.length === 0) {
    throw new Error('requirePermission() needs at least one permission; use anyAuthenticated()');
  }
  for (const permission of permissions) {
    if (!isPermission(permission)) throw new Error(`Unknown permission "${permission}"`);
  }
  const required = Object.freeze([...permissions]);

  const middleware = (req, _res, next) => {
    if (!req.actor) return next(new UnauthenticatedError());
    if (!required.every((permission) => can(req.actor.role, permission))) {
      return next(new ForbiddenError());
    }
    next();
  };
  middleware.permissions = required;
  return tagGuard(middleware, GUARD.PERMISSION);
}

/**
 * Route guard for self-service endpoints every signed-in user may call whatever their role
 * (e.g. /auth/me, /auth/logout). Explicit, so the route audit can tell it from a forgotten check.
 * @returns {import('express').RequestHandler}
 */
export function anyAuthenticated() {
  return tagGuard((req, _res, next) => {
    next(req.actor ? undefined : new UnauthenticatedError());
  }, GUARD.ANY_AUTHENTICATED);
}
