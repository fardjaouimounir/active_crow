// Turns an actor into a data scope (docs/01 §2.3). Repositories receive the scope and build their
// filters with core/authz/scopeFilters.js; they never look at roles themselves.

/**
 * @typedef {(
 *   | { level: 'agency', agencyId: string }
 *   | { level: 'regional', agencyId: string, userId: string }
 *   | { level: 'supervisor', agencyId: string, userId: string }
 *   | { level: 'self', agencyId: string, userId: string }
 *   | { level: 'client', agencyId: string, clientId: string }
 *   | { level: 'system' }
 * )} Scope
 */

/**
 * Unrestricted scope for background jobs only (CLAUDE.md §5). Scope filters recognise this exact
 * frozen object, so a hand-made `{ level: 'system' }` is rejected.
 */
export const SYSTEM_SCOPE = Object.freeze({ level: 'system' });

export const SCOPE_LEVELS = Object.freeze([
  'agency',
  'regional',
  'supervisor',
  'self',
  'client',
  'system',
]);

/**
 * @param {Readonly<import('../auth/actor.js').UserActor>} actor
 * @returns {Readonly<Scope>}
 */
function resolve(actor) {
  if (actor?.type !== 'user' || !actor.id || !actor.agencyId) {
    throw new Error(
      'ScopeService.resolve needs an authenticated user actor; jobs use SYSTEM_SCOPE',
    );
  }
  const { agencyId, id: userId } = actor;
  switch (actor.role) {
    case 'director':
    case 'general_manager':
      return Object.freeze({ level: 'agency', agencyId });
    case 'regional_manager':
      return Object.freeze({ level: 'regional', agencyId, userId });
    case 'supervisor':
      return Object.freeze({ level: 'supervisor', agencyId, userId });
    case 'animateur':
      return Object.freeze({ level: 'self', agencyId, userId });
    case 'client':
      if (!actor.clientId) throw new Error('A client actor must have a clientId');
      return Object.freeze({ level: 'client', agencyId, clientId: actor.clientId });
    default:
      throw new Error(`No data scope for role "${actor.role}"`);
  }
}

const requestScopes = new WeakMap();

/**
 * The scope of the request's actor, resolved once and cached for the rest of the request.
 * @param {import('express').Request} req
 * @returns {Readonly<Scope>}
 */
function forRequest(req) {
  let scope = requestScopes.get(req);
  if (!scope) {
    scope = resolve(req.actor);
    requestScopes.set(req, scope);
  }
  return scope;
}

export const ScopeService = Object.freeze({ resolve, forRequest });
