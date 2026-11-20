import { ok } from '../../core/http/index.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './auth.cookies.js';
import * as authService from './auth.service.js';

/**
 * The only user shape sent to clients. Fields are picked one by one: nothing else (hash, token
 * version, status) can leak through.
 * @param {{ id: string, fullName: string, email: string, role: string, agencyId: string, clientId: string | null, mustChangePassword: boolean }} user
 */
export function toPublicUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    agencyId: user.agencyId,
    clientId: user.clientId ?? null,
    mustChangePassword: user.mustChangePassword,
  };
}

/** @param {import('express').Request} req @returns {import('./auth.service.js').RequestContext} */
function requestContext(req) {
  return { ip: req.ip ?? null, id: req.id, userAgent: req.get('user-agent') ?? null };
}

/** Sets the rotated refresh cookie and answers `{ data: { accessToken, expiresIn, user } }`. */
function sendSession(res, { accessToken, expiresIn, user, refresh }) {
  setRefreshCookie(res, refresh);
  res.set('Cache-Control', 'no-store');
  return ok(res, { accessToken, expiresIn, user: toPublicUser(user) });
}

export async function login(req, res) {
  sendSession(res, await authService.login(req.body, requestContext(req)));
}

export async function refresh(req, res) {
  try {
    sendSession(res, await authService.refresh(readRefreshCookie(req), requestContext(req)));
  } catch (err) {
    // A dead cookie is useless: drop it so the browser stops sending it.
    clearRefreshCookie(res);
    throw err;
  }
}

export async function logout(req, res) {
  await authService.logout(req.actor, readRefreshCookie(req), requestContext(req));
  clearRefreshCookie(res);
  res.status(204).end();
}

export async function logoutAll(req, res) {
  await authService.logoutAll(req.actor, requestContext(req));
  clearRefreshCookie(res);
  res.status(204).end();
}

export async function changePassword(req, res) {
  sendSession(res, await authService.changePassword(req.actor, req.body, requestContext(req)));
}

export async function me(req, res) {
  const { user, permissions } = await authService.me(req.actor);
  res.set('Cache-Control', 'no-store');
  return ok(res, { user: toPublicUser(user), permissions });
}
