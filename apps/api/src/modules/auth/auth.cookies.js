import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../../config/constants.js';
import { env } from '../../config/env.js';

/** httpOnly; Secure (except development); SameSite=Strict; Path=/api/v1/auth. */
const cookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: /** @type {const} */ ('strict'),
  path: REFRESH_COOKIE_PATH,
});

/**
 * @param {import('express').Response} res
 * @param {{ token: string, expiresAt: Date }} refresh
 */
export function setRefreshCookie(res, { token, expiresAt }) {
  res.cookie(REFRESH_COOKIE_NAME, token, { ...cookieOptions(), expires: expiresAt });
}

/** @param {import('express').Response} res */
export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions());
}

/** @param {import('express').Request} req @returns {string | undefined} */
export function readRefreshCookie(req) {
  const value = req.cookies?.[REFRESH_COOKIE_NAME];
  return typeof value === 'string' ? value : undefined;
}
