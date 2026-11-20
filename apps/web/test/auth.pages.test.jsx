import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { authStore } from '../src/shared/auth/authStore.js';
import { resetSessionForTests } from '../src/shared/auth/session.js';
import { tokenStore } from '../src/shared/auth/tokenStore.js';
import i18n from '../src/shared/i18n/index.js';
import { apiError, makeUser, mockApi, networkError, sessionFor } from './helpers/mockApi.js';
import { renderApp } from './helpers/renderApp.jsx';

const HEALTH = () => [
  200,
  { data: { status: 'ok', db: 'up', version: '0.1.0', uptimeSeconds: 1 } },
];
const ANONYMOUS = { 'POST /auth/refresh': () => apiError(401, 'SESSION_EXPIRED') };

/** Routes for a user who is already signed in when the page loads. */
function signedIn(user) {
  return {
    'POST /auth/refresh': () => [200, sessionFor(user)],
    'GET /auth/me': () => [200, { data: { user, permissions: [] } }],
    'GET /health': HEALTH,
  };
}

let api;
afterEach(() => {
  api?.restore();
  resetSessionForTests();
});

async function fillLogin(email, password) {
  if (email) await userEvent.type(screen.getByLabelText('Email'), email);
  if (password) await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('login page', () => {
  it('validates the fields before calling the API', async () => {
    api = mockApi(ANONYMOUS);
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Sign in' });

    await fillLogin();
    expect(screen.getAllByText('This field is required.')).toHaveLength(2);
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');

    await fillLogin('not-an-email', 'whatever');
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(api.count('POST /auth/login')).toBe(0);
  });

  it.each([
    [
      'INVALID_CREDENTIALS',
      () => apiError(401, 'INVALID_CREDENTIALS'),
      'Incorrect email or password.',
    ],
    [
      'RATE_LIMITED',
      () => apiError(429, 'RATE_LIMITED'),
      'Too many requests. Please wait a moment and try again.',
    ],
    ['NETWORK_ERROR', networkError, 'Cannot reach the server. Check your connection.'],
  ])('shows %s as a global error', async (_code, handler, message) => {
    api = mockApi({ ...ANONYMOUS, 'POST /auth/login': handler });
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Sign in' });

    await fillLogin('amina@agency.dz', 'secret-pass-1');

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    // A 401 from /auth/login never triggers a refresh (only the page-load bootstrap did).
    expect(api.count('POST /auth/refresh')).toBe(1);
  });

  it('sends the normalised email and disables the button while submitting', async () => {
    let release;
    api = mockApi({
      ...ANONYMOUS,
      'POST /auth/login': () =>
        new Promise((resolve) => {
          release = () => resolve(apiError(401, 'INVALID_CREDENTIALS'));
        }),
    });
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Sign in' });

    await fillLogin('  Amina@Agency.DZ ', 'secret-pass-1');

    const button = await screen.findByRole('button', { name: 'Signing in…' });
    expect(button).toBeDisabled();
    expect(api.calls.find((c) => c.key === 'POST /auth/login').body).toEqual({
      email: 'amina@agency.dz',
      password: 'secret-pass-1',
    });
    release();
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('renders right-to-left in Arabic', async () => {
    await i18n.changeLanguage('ar');
    api = mockApi(ANONYMOUS);
    renderApp('/login');

    expect(await screen.findByRole('heading', { name: 'تسجيل الدخول' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByLabelText('البريد الإلكتروني')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('button', { name: 'دخول' })).toBeInTheDocument();
  });
});

describe('redirect by role after login', () => {
  it.each([
    ['director', '/app'],
    ['general_manager', '/app'],
    ['regional_manager', '/app'],
    ['supervisor', '/app'],
    ['animateur', '/field'],
    ['client', '/portal'],
  ])('%s lands on %s', async (role, path) => {
    const user = makeUser({ role, clientId: role === 'client' ? 'c-1' : null });
    api = mockApi({
      ...ANONYMOUS,
      'POST /auth/login': () => [200, sessionFor(user)],
      'GET /health': HEALTH,
    });
    const { location } = renderApp('/login');
    await screen.findByRole('heading', { name: 'Sign in' });

    await fillLogin(user.email, 'secret-pass-1');

    await waitFor(() => expect(location()).toBe(path));
    expect(tokenStore.get()).toBe('access-1');
  });

  it('a user who must change their password is sent to /change-password', async () => {
    const user = makeUser({ mustChangePassword: true });
    api = mockApi({ ...ANONYMOUS, 'POST /auth/login': () => [200, sessionFor(user)] });
    const { location } = renderApp('/login');
    await screen.findByRole('heading', { name: 'Sign in' });

    await fillLogin(user.email, 'temporary-pass-1');

    expect(
      await screen.findByRole('heading', { name: 'Change your password' }),
    ).toBeInTheDocument();
    expect(location()).toBe('/change-password');
  });

  it.each([
    ['a same-surface next', '/login?next=%2Fapp%3Ftab%3D1', '/app?tab=1'],
    ['a protocol-relative next', '/login?next=%2F%2Fevil.example', '/app'],
    ['an absolute URL', '/login?next=https%3A%2F%2Fevil.example', '/app'],
    ['another surface', '/login?next=%2Ffield', '/app'],
  ])('honours only safe `next` values: %s', async (_label, start, expected) => {
    const user = makeUser();
    api = mockApi({
      ...ANONYMOUS,
      'POST /auth/login': () => [200, sessionFor(user)],
      'GET /health': HEALTH,
    });
    const { location } = renderApp(start);
    await screen.findByRole('heading', { name: 'Sign in' });

    await fillLogin(user.email, 'secret-pass-1');

    await waitFor(() => expect(location()).toBe(expected));
  });
});

describe('route guards', () => {
  it('an anonymous visitor of a protected page is sent to /login?next=…', async () => {
    api = mockApi(ANONYMOUS);
    const { location } = renderApp('/app');

    await screen.findByRole('heading', { name: 'Sign in' });
    expect(location()).toBe('/login?next=%2Fapp');
  });

  it('reload: the session is restored from the refresh cookie (refresh then me)', async () => {
    api = mockApi(signedIn(makeUser()));
    const { location } = renderApp('/app');

    expect(await screen.findByText('Amina Benali')).toBeInTheDocument();
    expect(location()).toBe('/app');
    expect(api.calls.map((c) => c.key).slice(0, 2)).toEqual(['POST /auth/refresh', 'GET /auth/me']);
    expect(api.calls[1].authorization).toBe('Bearer access-1');
  });

  it.each([
    ['director', '/field', '/app'],
    ['director', '/portal', '/app'],
    ['animateur', '/app', '/field'],
    ['client', '/field', '/portal'],
  ])('%s opening %s is redirected to %s', async (role, start, expected) => {
    api = mockApi(signedIn(makeUser({ role, clientId: role === 'client' ? 'c-1' : null })));
    const { location } = renderApp(start);

    await waitFor(() => expect(location()).toBe(expected));
  });

  it('while a password change is required, every surface redirects to /change-password', async () => {
    api = mockApi(signedIn(makeUser({ mustChangePassword: true })));
    const { location } = renderApp('/app');

    await screen.findByRole('heading', { name: 'Change your password' });
    expect(location()).toBe('/change-password?next=%2Fapp');
  });
});

describe('surface header and logout', () => {
  it('shows the full name and translated role; logout clears the session and returns to /login', async () => {
    api = mockApi({
      ...signedIn(makeUser({ role: 'supervisor' })),
      'POST /auth/logout': () => [204, ''],
    });
    const { location } = renderApp('/app');

    expect(await screen.findByText('Amina Benali')).toBeInTheDocument();
    expect(screen.getByText('Superviseur')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await screen.findByRole('heading', { name: 'Sign in' });
    expect(location()).toBe('/login');
    expect(api.count('POST /auth/logout')).toBe(1);
    expect(tokenStore.get()).toBeNull();
    expect(authStore.getSnapshot()).toEqual({ status: 'anonymous', user: null, endedBy: 'logout' });
  });

  it('translates the role in Arabic', async () => {
    await i18n.changeLanguage('ar');
    api = mockApi(signedIn(makeUser({ role: 'animateur' })));
    renderApp('/field');

    expect(await screen.findByText('منشط')).toBeInTheDocument();
  });
});

describe('change password page', () => {
  const user = makeUser({ mustChangePassword: true });

  async function fill({ current, next, confirm }) {
    if (current) await userEvent.type(screen.getByLabelText('Current password'), current);
    if (next) await userEvent.type(screen.getByLabelText('New password'), next);
    if (confirm) await userEvent.type(screen.getByLabelText('Confirm new password'), confirm);
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
  }

  it('shows the policy as a live checklist and checks the confirmation', async () => {
    api = mockApi(signedIn(user));
    renderApp('/change-password');
    await screen.findByRole('heading', { name: 'Change your password' });
    expect(screen.getByText('be at least 10 characters long')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('New password'), 'abc1');
    expect(screen.getByText('contain at least one letter').closest('li')).toHaveAttribute(
      'data-met',
      'true',
    );
    expect(screen.getByText('be at least 10 characters long').closest('li')).toHaveAttribute(
      'data-met',
      'false',
    );

    await userEvent.clear(screen.getByLabelText('New password'));
    await fill({ current: 'temporary-1', next: 'brand-new-pass-9', confirm: 'something-else-9' });
    expect(screen.getByText('The passwords do not match.')).toBeInTheDocument();
    expect(api.count('POST /auth/change-password')).toBe(0);
  });

  it('maps CURRENT_PASSWORD_INCORRECT to the current-password field', async () => {
    api = mockApi({
      ...signedIn(user),
      'POST /auth/change-password': () => apiError(400, 'CURRENT_PASSWORD_INCORRECT'),
    });
    renderApp('/change-password');
    await screen.findByRole('heading', { name: 'Change your password' });

    await fill({ current: 'wrong-pass-1', next: 'brand-new-pass-9', confirm: 'brand-new-pass-9' });

    expect(await screen.findByText('The current password is incorrect.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('on success stores the new session and lands on the user’s surface', async () => {
    const changed = { ...user, mustChangePassword: false };
    api = mockApi({
      ...signedIn(user),
      'POST /auth/change-password': () => [200, sessionFor(changed, 'access-2')],
    });
    const { location } = renderApp('/app');
    await screen.findByRole('heading', { name: 'Change your password' });

    await fill({ current: 'temporary-1', next: 'brand-new-pass-9', confirm: 'brand-new-pass-9' });

    await waitFor(() => expect(location()).toBe('/app'));
    expect(tokenStore.get()).toBe('access-2');
    expect(api.calls.find((c) => c.key === 'POST /auth/change-password').body).toEqual({
      currentPassword: 'temporary-1',
      newPassword: 'brand-new-pass-9',
    });
  });
});
