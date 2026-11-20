/** Which surface each role works in: staff → /app, Animateur → /field, client → /portal. */
const SURFACE_BY_ROLE = Object.freeze({
  director: 'app',
  general_manager: 'app',
  regional_manager: 'app',
  supervisor: 'app',
  animateur: 'field',
  client: 'portal',
});

/** @param {string | undefined} role @returns {'app' | 'field' | 'portal' | null} */
export function surfaceFor(role) {
  return Object.hasOwn(SURFACE_BY_ROLE, role ?? '') ? SURFACE_BY_ROLE[role] : null;
}

/** @param {string | undefined} role */
export function homePathFor(role) {
  const surface = surfaceFor(role);
  return surface ? `/${surface}` : '/login';
}

/**
 * Accepts only same-origin relative paths: a single leading `/`, no `//` or `/\` (protocol-relative
 * URLs), no backslashes or control characters. Anything else → null.
 * @param {string | null | undefined} next
 * @returns {string | null}
 */
export function safeNextPath(next) {
  if (typeof next !== 'string' || next.length === 0 || next.length > 2048) return null;
  if (!next.startsWith('/') || next.startsWith('//')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return null;
  return next;
}

/** @param {string} path @param {string | undefined} role true if `path` belongs to the role's surface */
export function isOnOwnSurface(path, role) {
  const surface = surfaceFor(role);
  const pathname = path.split(/[?#]/)[0];
  return surface !== null && (pathname === `/${surface}` || pathname.startsWith(`/${surface}/`));
}
