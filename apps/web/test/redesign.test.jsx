import { ROLE_PERMISSIONS, calculateKpis } from '@fieldflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetSessionForTests } from '../src/shared/auth/session.js';
import i18n from '../src/shared/i18n/index.js';
import { applySurface, resolveTheme, setTheme } from '../src/ui/theme.js';
import { makeUser, mockApi, sessionFor } from './helpers/mockApi.js';
import { renderApp } from './helpers/renderApp.jsx';

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
}

const campaignId = '99111111-1111-4111-8111-111111111111';
const campaign = {
  id: campaignId,
  code: 'CMP-2027-001',
  name: 'Ramadan 2027',
  description: null,
  status: 'active',
  startDate: '2027-02-10',
  endDate: '2027-03-12',
  budgetAmount: '2500000.00',
  assignmentApproverRole: 'regional_manager',
  version: 1,
  client: { id: 'client-1', name: 'Hamoud' },
  requiredAnimateurs: 3,
  wilayas: [],
  pointsOfSale: [],
  products: [],
  counts: {
    wilayas: 1,
    requiredAnimateurs: 3,
    staff: 1,
    pointsOfSale: 0,
    products: 0,
    documents: 0,
  },
};
const period = { from: '2026-11-16', to: '2026-11-20' };
const stats = calculateKpis(period, {
  salesUnits: 18,
  salesCount: 6,
  verified: 2,
  expectedSlots: 4,
});
const ok = (data, meta) => [200, { data, ...(meta ? { meta } : {}) }];
let api;

function stub(role, extra = {}) {
  const user = makeUser({ role });
  api = mockApi({
    'POST /auth/refresh': () => [200, sessionFor(user)],
    'GET /auth/me': () => ok({ user, permissions: ROLE_PERMISSIONS[role] }),
    'GET /notifications/unread-count': () => ok({ count: 0 }),
    'GET /reference/wilayas': () => ok([{ id: 16, nameEn: 'Algiers', nameAr: 'الجزائر' }]),
    'GET /campaigns': ({ params }) =>
      ok(params?.q === 'ardis' ? [] : [campaign], { page: 1, pageSize: 5, total: 1 }),
    [`GET /campaigns/${campaignId}`]: () => ok(campaign),
    [`GET /campaigns/${campaignId}/readiness`]: () => ok({ actions: [] }),
    [`GET /campaigns/${campaignId}/documents`]: () => ok([]),
    'GET /points-of-sale': () =>
      ok([{ id: 'store-1', name: 'Ardis Hydra', code: 'P-17' }], {
        page: 1,
        pageSize: 5,
        total: 1,
      }),
    'GET /users': () =>
      ok([{ id: 'user-1', fullName: 'Amine Bensalem', role: 'animateur' }], {
        page: 1,
        pageSize: 5,
        total: 1,
      }),
    'GET /reports/kpis': () =>
      ok({ ...stats, alerts: { oldPending: 1, unvisitedStores: 2 }, options: {} }),
    'GET /reports/breakdown': () => ok([]),
    ...extra,
  });
}

beforeEach(() => localStorage.clear());
afterEach(async () => {
  api?.restore();
  resetSessionForTests();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-surface');
  await i18n.changeLanguage('en');
});

describe('theme persistence', () => {
  it('defaults to dark on /app and /portal and to light on /field', () => {
    expect(resolveTheme('app')).toBe('dark');
    expect(resolveTheme('portal')).toBe('dark');
    expect(resolveTheme('field')).toBe('light');
    applySurface('field');
    expect(document.documentElement.dataset).toMatchObject({ surface: 'field', theme: 'light' });
  });

  it('remembers a choice per surface and does not leak it to the others', () => {
    applySurface('app');
    setTheme('light');
    expect(localStorage.getItem('acticrew.theme.app')).toBe('light');
    applySurface('field');
    expect(document.documentElement.dataset.theme).toBe('light');
    setTheme('dark');
    applySurface('app');
    expect(document.documentElement.dataset.theme).toBe('light');
    applySurface('field');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('survives blocked storage (falls back to the surface default)', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    try {
      expect(resolveTheme('app')).toBe('dark');
    } finally {
      Storage.prototype.getItem = original;
    }
  });

  it('the shell toggle switches the theme and the choice is kept after a reload', async () => {
    stub('director');
    const user = userEvent.setup();
    const first = renderApp('/app/dashboard');
    await user.click(await screen.findByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('acticrew.theme.app')).toBe('light');
    first.unmount();
    document.documentElement.removeAttribute('data-theme');
    renderApp('/app/dashboard');
    expect(await screen.findByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('command palette', () => {
  it(
    'opens with Ctrl+K, searches the scoped list endpoints, moves with the arrows and opens a result with Enter',
    { timeout: 20_000 },
    async () => {
      stub('director');
      const user = userEvent.setup();
      const view = renderApp('/app/dashboard');
      await screen.findByRole('heading', { name: 'Performance dashboard' });
      await user.keyboard('{Control>}k{/Control}');
      const box = await screen.findByRole('combobox', { name: 'Jump to' });
      expect(box).toHaveFocus();
      await user.type(box, 'ram');
      // Rows re-mount while a new query loads, so look each option up again instead of holding it.
      const selected = (name) =>
        waitFor(() =>
          expect(screen.getByRole('option', { name })).toHaveAttribute('aria-selected', 'true'),
        );
      await selected(/Ramadan 2027/);
      // The same query reaches the existing list endpoint, five rows at most.
      await waitFor(() => expect(api.count('GET /campaigns')).toBeGreaterThan(0));
      await user.clear(box);
      await user.type(box, 'ardis');
      await waitFor(() =>
        expect(screen.queryByRole('option', { name: /Ramadan 2027/ })).toBeNull(),
      );
      // Stores come before people: the store is first, ArrowDown moves to the person, ArrowUp back.
      await selected(/Ardis Hydra/);
      await user.keyboard('{ArrowDown}');
      await selected(/Amine Bensalem/);
      await user.keyboard('{ArrowUp}');
      await selected(/Ardis Hydra/);
      await user.keyboard('{Enter}');
      await waitFor(() => expect(view.location()).toBe('/app/points-of-sale/store-1'));
      expect(screen.queryByRole('combobox', { name: 'Jump to' })).toBeNull();
    },
  );

  it('jumps to a page by name and closes with Escape', { timeout: 20_000 }, async () => {
    stub('director');
    const user = userEvent.setup();
    const view = renderApp('/app/dashboard');
    await screen.findByRole('heading', { name: 'Performance dashboard' });
    await user.click(screen.getByRole('button', { name: 'Search or jump to…' }));
    const box = await screen.findByRole('combobox', { name: 'Jump to' });
    await user.type(box, 'issues');
    const palette = within(screen.getByRole('dialog', { name: 'Jump to' }));
    expect(palette.getAllByRole('option')[0]).toHaveTextContent('Issues');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(view.location()).toBe('/app/issues'));
    await user.keyboard('{Control>}k{/Control}');
    await screen.findByRole('combobox', { name: 'Jump to' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Jump to' })).toBeNull());
  });

  it('shows nothing the role cannot list (a supervisor gets no store search)', async () => {
    stub('supervisor');
    const user = userEvent.setup();
    renderApp('/app/dashboard');
    await screen.findByRole('heading', { name: 'Performance dashboard' });
    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('combobox', { name: 'Jump to' }), 'ardis');
    await screen.findByText(/Nothing matches/);
    expect(api.count('GET /points-of-sale')).toBe(0);
  });
});

/** Physical-direction utilities have no place in the redesigned markup. */
const PHYSICAL =
  /\b(?:ml|mr|pl|pr)-\d|\b(?:left|right)-\d|\btext-(?:left|right)\b|\b(?:border|rounded)-(?:l|r)(?:-|\b)/;

function shellFacts() {
  const root = document.documentElement;
  const nav = screen.getByRole('navigation', { name: 'القائمة' });
  return {
    dir: root.dir,
    lang: root.lang,
    surface: root.dataset.surface,
    theme: root.dataset.theme,
    groups: within(nav)
      .getAllByRole('group')
      .map((group) => group.getAttribute('aria-label')),
    physicalClasses: PHYSICAL.test(document.body.innerHTML),
  };
}

describe.each(['dark', 'light'])('RTL shell in the %s theme', (theme) => {
  beforeEach(() => localStorage.setItem('acticrew.theme.app', theme));

  it('dashboard', async () => {
    await i18n.changeLanguage('ar');
    stub('director');
    renderApp('/app/dashboard');
    await screen.findByRole('heading', { name: 'لوحة الأداء' });
    expect(shellFacts()).toEqual({
      dir: 'rtl',
      lang: 'ar',
      surface: 'app',
      theme,
      groups: [
        'نظرة عامة',
        'الحملات',
        'العمليات الميدانية',
        'المخزون',
        'الأشخاص والشبكة',
        'العملاء',
        'مراجعة الذكاء الاصطناعي',
        'الإعدادات',
      ],
      physicalClasses: false,
    });
  });

  it('campaign detail with the lifecycle stepper', async () => {
    await i18n.changeLanguage('ar');
    stub('director');
    renderApp(`/app/campaigns/${campaignId}`);
    await screen.findByRole('heading', { name: 'Ramadan 2027' });
    const stepper = screen.getByRole('list', { name: 'تقدم الحملة' });
    expect(
      within(stepper)
        .getAllByRole('listitem')
        .filter((item) => item.getAttribute('aria-current')),
    ).toHaveLength(1);
    expect(shellFacts()).toMatchObject({ dir: 'rtl', theme, physicalClasses: false });
  });
});

describe.each(['light', 'dark'])('RTL field Today in the %s theme', (theme) => {
  it('renders the Arabic shell with the surface theme and logical-only utilities', async () => {
    localStorage.setItem('acticrew.theme.field', theme);
    const user = makeUser({ role: 'animateur' });
    const day = {
      date: '2026-11-20',
      salesCount: 0,
      units: 0,
      giftsDelivered: 0,
      interactions: {},
      undelivered: [],
      giftBalances: [],
      field: null,
      nextAssignmentDate: '2026-11-21',
    };
    api = mockApi({
      'POST /auth/refresh': () => [200, sessionFor(user)],
      'GET /auth/me': () => ok({ user, permissions: ROLE_PERMISSIONS.animateur }),
      'GET /me/sales/today': () => ok(day),
      'GET /me/attendance/today': () => ok({ assignments: [] }),
      'GET /me/stock': () => ok({ awaitingConfirmation: [] }),
      'GET /notifications': () => ok([]),
      'GET /issues': () => ok([]),
    });
    renderApp('/field');
    const heading = await screen.findByRole('heading', { name: 'اليوم', level: 1 });
    const shell = heading.closest('[dir]');
    const root = document.documentElement;
    expect({
      dir: shell.getAttribute('dir'),
      lang: shell.getAttribute('lang'),
      surface: root.dataset.surface,
      theme: root.dataset.theme,
      tabs: within(within(shell).getByRole('navigation'))
        .getAllByRole('link')
        .map((link) => link.textContent),
      physicalClasses: PHYSICAL.test(document.body.innerHTML),
    }).toEqual({
      dir: 'rtl',
      lang: 'ar',
      surface: 'field',
      theme,
      tabs: ['اليوم', 'الحضور', 'البيع', 'بلاغ'],
      physicalClasses: false,
    });
  }, 20_000);
});

describe('design kit page', () => {
  it(
    'shows the kit in dark/light × LTR/RTL specimens (development builds)',
    { timeout: 20_000 },
    async () => {
      stub('director');
      renderApp('/app/_design');
      await screen.findByRole('heading', { name: 'ActiCrew design kit' });
      const specimens = document.querySelectorAll('[data-theme][dir]');
      expect(
        [...specimens]
          .filter((node) => node !== document.documentElement)
          .map((node) => `${node.getAttribute('data-theme')}/${node.getAttribute('dir')}`),
      ).toEqual(['dark/ltr', 'dark/rtl', 'light/ltr', 'light/rtl']);
    },
  );
});
