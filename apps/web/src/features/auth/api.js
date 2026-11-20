import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as authApi from '../../shared/auth/authApi.js';
import { applySession, logout } from '../../shared/auth/session.js';

/** On success the session is stored; the login route's guard then redirects by role. */
export function useLoginMutation() {
  return useMutation({ mutationFn: authApi.login, onSuccess: applySession });
}

/** On success the new session (other sessions revoked by the API) replaces the current one. */
export function useChangePasswordMutation() {
  return useMutation({ mutationFn: authApi.changePassword, onSuccess: applySession });
}

/** Ends the session and drops every cached query, so nothing of the previous user remains. */
export function useLogoutMutation() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: logout, onSettled: () => queryClient.clear() });
}
