// Markers that route middlewares carry, so a test can walk the Express router stack and prove that
// every route is either explicitly public or authenticated + permission-checked (deny by default).

export const ROUTE_GUARD = Symbol.for('fieldflow.routeGuard');

export const GUARD = Object.freeze({
  AUTHENTICATE: 'authenticate',
  PERMISSION: 'permission',
  ANY_AUTHENTICATED: 'any-authenticated',
  PUBLIC: 'public',
});

/**
 * @template {Function} T
 * @param {T} middleware
 * @param {string} guard one of GUARD
 * @returns {T}
 */
export function tagGuard(middleware, guard) {
  Object.defineProperty(middleware, ROUTE_GUARD, { value: guard, enumerable: false });
  return middleware;
}

/** @param {unknown} middleware @returns {string | undefined} */
export function guardOf(middleware) {
  return typeof middleware === 'function' ? middleware[ROUTE_GUARD] : undefined;
}

/**
 * Marks a route as intentionally reachable without a session (health check, login, refresh).
 * Does nothing at runtime; the route audit test keeps the list of public routes explicit.
 * @returns {import('express').RequestHandler}
 */
export function publicRoute() {
  return tagGuard((_req, _res, next) => next(), GUARD.PUBLIC);
}
