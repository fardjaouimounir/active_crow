// Raw calls to /api/v1/auth. UI code uses the hooks in features/auth/api.js instead.
import { apiClient } from '../api/client.js';

/**
 * @typedef {{ accessToken: string, expiresIn: number, user: import('./authStore.js').SessionUser }} SessionPayload
 */

/** @param {{ email: string, password: string }} credentials @returns {Promise<SessionPayload>} */
export async function login(credentials) {
  return (await apiClient.post('/auth/login', credentials)).data.data;
}

/** Uses only the httpOnly ff_rt cookie. @returns {Promise<SessionPayload>} */
export async function refresh() {
  return (await apiClient.post('/auth/refresh')).data.data;
}

/** @returns {Promise<{ user: import('./authStore.js').SessionUser, permissions: string[] }>} */
export async function me() {
  return (await apiClient.get('/auth/me')).data.data;
}

export async function logout() {
  await apiClient.post('/auth/logout', undefined, { timeout: 20_000 });
}

/** @param {{ currentPassword: string, newPassword: string }} input @returns {Promise<SessionPayload>} */
export async function changePassword(input) {
  return (await apiClient.post('/auth/change-password', input)).data.data;
}
