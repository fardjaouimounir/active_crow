import { createBrowserRouter, redirect } from 'react-router';
import { RouteError } from './RouteError.jsx';
import { RouteFallback } from './RouteFallback.jsx';

/** Each surface is a separate lazy chunk: staff app, Animateur PWA, client portal. */
export const routes = [
  {
    path: '/',
    HydrateFallback: RouteFallback,
    ErrorBoundary: RouteError,
    children: [
      { index: true, loader: () => redirect('/app') },
      {
        path: 'app',
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
      {
        path: 'field',
        lazy: async () => ({ Component: (await import('./layouts/FieldLayout.jsx')).FieldLayout }),
      },
      {
        path: 'portal',
        lazy: async () => ({
          Component: (await import('./layouts/PortalLayout.jsx')).PortalLayout,
        }),
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
