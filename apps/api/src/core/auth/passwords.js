// Password hashing with argon2id (@node-rs/argon2 ships prebuilt binaries, no native build needed).
import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/** OWASP baseline for argon2id: 19 MiB memory, 2 iterations, 1 lane. The library default algorithm is argon2id. */
const HASH_OPTIONS = Object.freeze({ memoryCost: 19_456, timeCost: 2, parallelism: 1 });

/** @param {string} password */
export function hashPassword(password) {
  return hash(password, HASH_OPTIONS);
}

/**
 * `false` for a wrong password and for a stored value that is not a valid argon2 hash.
 * @param {string} passwordHash
 * @param {string} password
 */
export async function verifyPassword(passwordHash, password) {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash;

/**
 * Runs a full argon2 verification against a throw-away hash, so a login for an unknown email takes
 * as long as one for a known email (no account enumeration by timing). Always resolves `false`.
 * @param {string} password
 */
export async function verifyDummyPassword(password) {
  dummyHash ??= hashPassword(randomBytes(32).toString('base64url'));
  await verifyPassword(await dummyHash, password);
  return false;
}
