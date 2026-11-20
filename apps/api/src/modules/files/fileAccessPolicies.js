// Who may read a file is decided by the module that owns its kind. Each module registers a policy
// for its kinds; a file of an unregistered kind is never readable (404).

/**
 * @typedef {(actor: object, file: object, db: object) => Promise<null | false | { filename?: string }>} FileAccessPolicy
 * Returns a falsy value to deny (answered 404), or an object, optionally with a display file name.
 */

/** @type {Map<string, FileAccessPolicy>} */
const policies = new Map();

/** @param {string} kind @param {FileAccessPolicy} policy */
export function registerFileAccessPolicy(kind, policy) {
  policies.set(kind, policy);
}

/**
 * The decision for `actor` on `file`, or null when the kind has no policy.
 * @param {object} actor @param {{ kind: string }} file @param {object} db
 */
export async function decideFileAccess(actor, file, db) {
  const policy = policies.get(file.kind);
  if (!policy) return null;
  return (await policy(actor, file, db)) || null;
}
