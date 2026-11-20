import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { Spinner } from '../ui/Spinner.jsx';
import { useAuth } from './hooks.js';
import { homePathFor, isOnOwnSurface, safeNextPath, surfaceFor } from './surfaces.js';

function SessionLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner />
    </div>
  );
}

/** `/login?next=<current path>`, or a plain `/login` right after an explicit logout. */
function useLoginRedirect() {
  const location = useLocation();
  const { endedBy } = useAuth();
  if (endedBy === 'logout') return '/login';
  const next = `${location.pathname}${location.search}`;
  return `/login?next=${encodeURIComponent(next)}`;
}

/**
 * Where a signed-in user should land: the change-password page while it is required, otherwise
 * `next` when it is a safe path on their own surface, otherwise their surface's home.
 * @param {import('./authStore.js').SessionUser} user
 * @param {string | null} next
 */
export function landingPathFor(user, next) {
  const safe = safeNextPath(next);
  if (user.mustChangePassword) {
    return safe ? `/change-password?next=${encodeURIComponent(safe)}` : '/change-password';
  }
  return safe && isOnOwnSurface(safe, user.role) ? safe : homePathFor(user.role);
}

/**
 * Guards a surface (/app, /field, /portal): signed in, password changed, and the role's own
 * surface — anyone else is redirected to theirs.
 * @param {{ surface: 'app' | 'field' | 'portal' }} props
 */
export function RequireSurface({ surface }) {
  const { status, user } = useAuth();
  const location = useLocation();
  const loginRedirect = useLoginRedirect();

  if (status === 'loading') return <SessionLoading />;
  if (status !== 'authenticated') return <Navigate to={loginRedirect} replace />;
  if (user.mustChangePassword) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/change-password?next=${next}`} replace />;
  }
  if (surfaceFor(user.role) !== surface) return <Navigate to={homePathFor(user.role)} replace />;
  return <Outlet />;
}

/** Any signed-in user (the change-password page). */
export function RequireSession() {
  const { status } = useAuth();
  const loginRedirect = useLoginRedirect();

  if (status === 'loading') return <SessionLoading />;
  if (status !== 'authenticated') return <Navigate to={loginRedirect} replace />;
  return <Outlet />;
}

/** The login page: signed-in users go straight to where they belong (this also runs after login). */
export function GuestOnly() {
  const { status, user } = useAuth();
  const [params] = useSearchParams();

  if (status === 'loading') return <SessionLoading />;
  if (status === 'authenticated')
    return <Navigate to={landingPathFor(user, params.get('next'))} replace />;
  return <Outlet />;
}

/** `/`: the user's home, or the login page. */
export function HomeRedirect() {
  const { status, user } = useAuth();

  if (status === 'loading') return <SessionLoading />;
  return (
    <Navigate to={status === 'authenticated' ? landingPathFor(user, null) : '/login'} replace />
  );
}
