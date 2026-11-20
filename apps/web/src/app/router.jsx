import { createBrowserRouter } from 'react-router';
import { GuestOnly, HomeRedirect, RequireSession, RequireSurface } from '../shared/auth/guards.jsx';
import { RouteError } from './RouteError.jsx';
import { RouteFallback } from './RouteFallback.jsx';

/**
 * Public: /login. Signed in: /change-password. Each surface is a separate lazy chunk behind its
 * guard: staff app, Animateur PWA, client portal (a user opening another surface is sent to theirs).
 */
export const routes = [
  {
    path: '/',
    HydrateFallback: RouteFallback,
    ErrorBoundary: RouteError,
    children: [
      { index: true, Component: HomeRedirect },
      {
        Component: GuestOnly,
        children: [
          {
            path: 'login',
            lazy: async () => ({
              Component: (await import('../features/auth/pages/LoginPage.jsx')).LoginPage,
            }),
          },
        ],
      },
      {
        Component: RequireSession,
        children: [
          {
            path: 'change-password',
            lazy: async () => ({
              Component: (await import('../features/auth/pages/ChangePasswordPage.jsx'))
                .ChangePasswordPage,
            }),
          },
        ],
      },
      {
        path: 'app',
        element: <RequireSurface surface="app" />,
        children: [
          {
            lazy: async () => ({ Component: (await import('./layouts/AppLayout.jsx')).AppLayout }),
            children: [
              {
                index: true,
                lazy: async () => ({
                  Component: (await import('../features/system/pages/SystemStatusPage.jsx'))
                    .SystemStatusPage,
                }),
              },
            ],
          },
        ],
      },
      {
        path: 'field',
        element: <RequireSurface surface="field" />,
        children: [
          {
            index: true,
            lazy: async () => ({
              Component: (await import('./layouts/FieldLayout.jsx')).FieldLayout,
            }),
          },
        ],
      },
      {
        path: 'portal',
        element: <RequireSurface surface="portal" />,
        children: [
          {
            index: true,
            lazy: async () => ({
              Component: (await import('./layouts/PortalLayout.jsx')).PortalLayout,
            }),
          },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
