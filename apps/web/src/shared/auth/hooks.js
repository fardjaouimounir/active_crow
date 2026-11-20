import { can } from '@fieldflow/shared';
import { useSyncExternalStore } from 'react';
import { authStore } from './authStore.js';

/** @returns {import('./authStore.js').AuthState} */
export function useAuth() {
  return useSyncExternalStore(authStore.subscribe, authStore.getSnapshot, authStore.getSnapshot);
}

/**
 * Whether the signed-in user's role holds `permission` (shared catalog). Hides UI only: the API
 * is the authority.
 * @param {string} permission
 */
export function useCan(permission) {
  const { user } = useAuth();
  return can(user?.role, permission);
}
