import { useEffect } from 'react';
import { bootstrapSession } from './session.js';

/**
 * Restores the session on page load (POST /auth/refresh with the httpOnly cookie, then GET /auth/me).
 * State lives in authStore; read it with useAuth().
 */
export function AuthProvider({ children }) {
  useEffect(() => {
    bootstrapSession();
  }, []);
  return children;
}
