// Auth helpers for API tests: users with real argon2 hashes, login, cookies.
import request from 'supertest';
import { expect } from 'vitest';
import { hashPassword } from '../../src/core/auth/index.js';
import { createUser } from '../../src/db/__tests__/factories.js';

export const DEFAULT_PASSWORD = 'correct-horse-42';

/**
 * A user with a real argon2id hash. `mustChangePassword` defaults to false so tests can call
 * protected routes right after login.
 * @param {string} agencyId
 * @param {{ password?: string } & Record<string, unknown>} [data]
 */
export async function createUserWithPassword(
  agencyId,
  { password = DEFAULT_PASSWORD, ...data } = {},
) {
  const user = await createUser(agencyId, {
    passwordHash: await hashPassword(password),
    mustChangePassword: false,
    ...data,
  });
  return { ...user, password };
}

/** @param {import('supertest').Response} res @returns {string | undefined} the raw `ff_rt=…` Set-Cookie line */
export function refreshSetCookie(res) {
  const cookies = [res.headers['set-cookie'] ?? []].flat();
  return cookies.find((line) => line.startsWith('ff_rt='));
}

/** @param {import('supertest').Response} res @returns {string} `ff_rt=<value>` for a Cookie header */
export function refreshCookie(res) {
  const line = refreshSetCookie(res);
  expect(line, 'expected an ff_rt cookie').toBeDefined();
  return line.split(';')[0];
}

/**
 * Logs in and returns the access token and the refresh cookie.
 * @param {import('express').Express} app
 * @param {{ email: string, password: string }} user
 */
export async function login(app, { email, password }) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { res, accessToken: res.body.data.accessToken, cookie: refreshCookie(res) };
}

/** @param {string} accessToken */
export const bearer = (accessToken) => ({ Authorization: `Bearer ${accessToken}` });
