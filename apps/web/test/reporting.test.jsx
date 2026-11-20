import { ROLE_PERMISSIONS, calculateKpis } from '@fieldflow/shared';
import { existsSync, readFileSync } from 'node:fs';
import userEvent from '@testing-library/user-event';
import { screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import i18n from '../src/shared/i18n/index.js';
import { resetSessionForTests } from '../src/shared/auth/session.js';
import { makeUser, mockApi, sessionFor } from './helpers/mockApi.js';
import { renderApp } from './helpers/renderApp.jsx';

const id = '11111111-1111-4111-8111-111111111112';
const period = { from: '2026-11-16', to: '2026-11-20' };
const wilayas = [{ id: 16, nameEn: 'Algiers', nameAr: 'الجزائر' }];
let api;
const response = (data) => [200, { data }];
const stats = (units = 18) =>
  calculateKpis(period, { salesUnits: units, salesCount: 6, verified: 2, expectedSlots: 4 });

function setup(role, extra = {}) {
  const user = makeUser({ role });
  api = mockApi({
    'POST /auth/refresh': () => [200, sessionFor(user)],
    'GET /auth/me': () => response({ user, permissions: ROLE_PERMISSIONS[role] }),
    'GET /notifications/unread-count': () => response({ count: 0 }),
    'GET /reports/kpis': ({ params }) =>
      response({
        ...stats(params.wilayaIds ? 9 : 18),
        alerts: { oldPending: 1, unvisitedStores: 2 },
        options: { wilayaIds: wilayas },
      }),
    'GET /reports/breakdown': ({ params }) =>
      response([
        {
          id: params.dimension === 'day' ? period.from : id,
          label: 'Test store',
          ...stats(params.wilayaIds ? 9 : 18),
        },
      ]),
    ...extra,
  });
}

afterEach(async () => {
  api?.restore();
  resetSessionForTests();
  await i18n.changeLanguage('en');
});

it('syncs filters with the URL, changes metrics and offers the chart data table', async () => {
  setup('director');
  const view = renderApp('/app/dashboard');
  expect(await screen.findByRole('heading', { name: 'Performance dashboard' })).toBeInTheDocument();
  const user = userEvent.setup();
  const willaya = screen.getByLabelText('Wilaya');
  await screen.findByRole('option', { name: 'Algiers' });
  await user.selectOptions(willaya, '16');
  expect(view.location()).toBe('/app/dashboard?wilayaIds=16');
  const section = (await screen.findByRole('heading', { name: 'Daily sales' })).closest('section');
  await user.click(within(section).getByText('View data'));
  expect(await within(section).findByRole('cell', { name: '9' })).toBeInTheDocument();
}, 20_000);

it.each([
  ['supervisor', 'By Animateur'],
  ['regional_manager', 'By Superviseur'],
])('renders the team table for %s', async (role, heading) => {
  setup(role);
  renderApp('/app/dashboard');
  expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  if (role === 'supervisor')
    expect(screen.queryByRole('heading', { name: 'Daily sales' })).not.toBeInTheDocument();
});

it('renders the director dashboard with Arabic labels and RTL', async () => {
  await i18n.changeLanguage('ar');
  setup('director');
  renderApp('/app/dashboard');
  const title = await screen.findByRole('heading', { name: 'لوحة الأداء' });
  expect(document.documentElement.dir).toEqual('rtl');
  expect(title.outerHTML).toMatchInlineSnapshot(
    `"<h1 class="text-2xl font-semibold tracking-tight">لوحة الأداء</h1>"`,
  );
});

it('opens the provisional campaign report with an A4 print stylesheet', async () => {
  setup('director', {
    [`GET /reports/campaigns/${id}/summary`]: () =>
      response({
        campaign: {
          code: 'CMP-1',
          name: 'Demo campaign',
          client: { name: 'Demo client' },
          status: 'active',
          startDate: period.from,
          endDate: period.to,
        },
        generatedAt: period.to,
        kpis: stats(),
        daily: [],
        wilayas: [],
        stores: [],
        issues: [],
        reconciliation: {},
      }),
  });
  renderApp(`/app/campaigns/${id}/report`);
  expect(await screen.findByRole('heading', { name: 'Demo campaign' })).toBeInTheDocument();
  expect(screen.getByText('Provisional')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Print / Save as PDF' })).toBeInTheDocument();
  const stylesheet = 'src/features/reporting/report-print.css';
  const printStyles = readFileSync(
    existsSync(stylesheet) ? stylesheet : 'apps/web/' + stylesheet,
    'utf8',
  );
  expect(printStyles).toMatch(/@media print[\s\S]+size: A4/);
});
