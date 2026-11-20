import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { AppProviders } from '../../src/app/providers.jsx';
import { routes } from '../../src/app/router.jsx';

/**
 * Renders the real route tree (guards, lazy pages, layouts) at `path`, with the real providers.
 * @param {string} path
 */
export function renderApp(path) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  const location = () => `${router.state.location.pathname}${router.state.location.search}`;
  return { ...view, router, location };
}
