/**
 * @typedef {object} UserActor
 * @property {'user'} type
 * @property {string} id
 * @property {string} agencyId
 * @property {import('@fieldflow/shared').USER_ROLES[number]} role
 * @property {string | null} clientId
 * @property {boolean} mustChangePassword
 */

/**
 * @typedef {object} SystemActor
 * @property {'system' | 'ai_service'} type
 * @property {null} id
 */

/**
 * The trusted identity of a request, built only from the database row (never from the token alone).
 * @param {{ id: string, agencyId: string, role: string, clientId: string | null, mustChangePassword: boolean }} user
 * @returns {Readonly<UserActor>}
 */
export function buildUserActor(user) {
  return Object.freeze({
    type: 'user',
    id: user.id,
    agencyId: user.agencyId,
    role: /** @type {UserActor['role']} */ (user.role),
    clientId: user.clientId ?? null,
    mustChangePassword: user.mustChangePassword,
  });
}

/** Actor for background jobs and CLI scripts (audit `actor_type = system`). */
export const SYSTEM_ACTOR = Object.freeze({ type: 'system', id: null });
