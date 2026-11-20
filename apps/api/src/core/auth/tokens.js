// Access tokens (HS256 JWT via jose) and opaque refresh tokens (random bytes, stored as SHA-256).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../../config/env.js';
import { SessionExpiredError } from '../errors/index.js';
import { clock } from '../time/clock.js';

const ALGORITHM = 'HS256';
const ISSUER = 'fieldflow-api';
const AUDIENCE = 'fieldflow';
const REFRESH_TOKEN_BYTES = 32;
const DAY_MS = 86_400_000;

const accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

/** Access-token lifetime in seconds (`expiresIn` in auth responses). */
export const ACCESS_TOKEN_TTL_SECONDS = env.ACCESS_TOKEN_TTL;

/**
 * @typedef {object} TokenUser
 * @property {string} id
 * @property {string} agencyId
 * @property {string} role
 * @property {string | null} clientId
 * @property {number} tokenVersion
 * @property {boolean} mustChangePassword
 */

/**
 * Signs a 15-minute (ACCESS_TOKEN_TTL) access token.
 * Claims: sub, agencyId, role, clientId (client users only), tv (token_version), mcp (must change password).
 * @param {TokenUser} user
 * @returns {Promise<{ accessToken: string, expiresIn: number }>}
 */
export async function signAccessToken(user) {
  const issuedAt = Math.floor(clock.now().getTime() / 1000);
  const accessToken = await new SignJWT({
    agencyId: user.agencyId,
    role: user.role,
    ...(user.clientId && { clientId: user.clientId }),
    tv: user.tokenVersion,
    mcp: user.mustChangePassword,
  })
    .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
    .sign(accessKey);
  return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/**
 * Verifies signature, algorithm, issuer, audience and expiry. Any failure is a SessionExpiredError,
 * so the client simply refreshes.
 * @param {string} token
 * @returns {Promise<{ sub: string, agencyId: string, role: string, clientId?: string, tv: number, mcp: boolean }>}
 */
export async function verifyAccessToken(token) {
  try {
    const { payload } = await jwtVerify(token, accessKey, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
      currentDate: clock.now(),
      requiredClaims: ['sub', 'exp', 'iat'],
    });
    if (typeof payload.sub !== 'string' || !Number.isInteger(payload.tv)) {
      throw new SessionExpiredError();
    }
    return /** @type {any} */ (payload);
  } catch {
    throw new SessionExpiredError();
  }
}

/** A new opaque refresh token (base64url, 32 random bytes). Only its hash is stored. */
export function generateRefreshToken() {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

/** @param {string} token @returns {string} SHA-256, hex */
export function hashRefreshToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of two hex token hashes.
 * @param {string} a
 * @param {string} b
 */
export function tokenHashesEqual(a, b) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/** @param {Date} [from] */
export function refreshTokenExpiry(from = clock.now()) {
  return new Date(from.getTime() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS);
}
