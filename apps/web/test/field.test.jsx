import { ROLE_PERMISSIONS } from '@fieldflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { resetSessionForTests } from '../src/shared/auth/session.js';
import { makeUser, mockApi, networkError, sessionFor } from './helpers/mockApi.js';
import { renderApp } from './helpers/renderApp.jsx';

const ids = {
  assignment: '11111111-1111-4111-8111-111111111111',
  campaign: '22222222-2222-4222-8222-222222222222',
  store: '33333333-3333-4333-8333-333333333333',
  product: '44444444-4444-4444-8444-444444444444',
  gift: '55555555-5555-4555-8555-555555555555',
};
const day = {
  date: '2026-11-20',
  salesCount: 3,
  units: 8,
  giftsDelivered: 1,
  interactions: { sample: 2 },
  undelivered: [
    { stockItem: { name: 'Mug' }, entitlements: [{ id: 'gift-entitlement', quantity: 1 }] },
  ],
  giftBalances: [],
  field: {
    assignmentId: ids.assignment,
    campaignId: ids.campaign,
    campaignName: 'Demo',
    campaignStatus: 'active',
    pointOfSale: { id: ids.store, name: 'Market', address: 'Algiers' },
    shiftStart: '08:00',
    shiftEnd: '16:00',
    closedReason: null,
    products: [{ id: ids.product, name: 'Juice' }],
    stockItems: [{ id: ids.gift, name: 'Mug' }],
    customerFields: { fullName: 'required', phone: 'required', consentRequired: true },
    promotions: [
      {
        id: 'promotion',
        name: 'Gift reward',
        productId: ids.product,
        tiers: [{ id: 'tier', stockItemId: ids.gift, minQuantity: 3, giftQuantity: 1 }],
      },
    ],
  },
};
const checkpoints = {
  assignments: [
    {
      assignmentId: ids.assignment,
      checkpoints: [
        {
          code: 'morning',
          label: { ar: 'الصباح', en: 'Morning' },
          photo: true,
          gps: true,
          isOpen: true,
          opensAt: '2026-11-20T07:30:00Z',
        },
      ],
    },
  ],
};
const movement = {
  id: 'transfer',
  campaign: { name: 'Demo' },
  lines: [{ stockItemId: ids.gift, quantity: 40, name: 'Mug' }],
};
const reply = (value) => () => [200, { data: value }];
const salePath = 'POST /assignments/' + ids.assignment + '/sales';
let api;

vi.mock('../src/surfaces/field/image.js', () => ({
  resizeFieldImage: async (file) => new File([file], 'photo.jpg', { type: 'image/jpeg' }),
}));

afterEach(() => {
  api?.restore();
  resetSessionForTests();
  sessionStorage.clear();
  localStorage.removeItem('fieldflow.field.language');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function start(path, overrides = {}, language = 'en') {
  if (language === 'en') localStorage.setItem('fieldflow.field.language', 'en');
  const user = makeUser({ role: 'animateur' });
  api = mockApi({
    'POST /auth/refresh': () => [200, sessionFor(user)],
    'GET /auth/me': reply({ user, permissions: ROLE_PERMISSIONS.animateur }),
    'GET /me/sales/today': reply(day),
    'GET /me/attendance/today': reply(checkpoints),
    'GET /me/stock': reply({ awaitingConfirmation: [movement] }),
    'GET /notifications': reply([]),
    'GET /issues': reply([]),
    ...overrides,
  });
  renderApp(path);
  return userEvent.setup();
}

it(
  'shows an assignment, delivers a gift and warns before a short stock receipt',
  { timeout: 20000 },
  async () => {
    const user = start('/field', {
      'POST /entitlements/gift-entitlement/deliver': reply({ status: 'distributed' }),
      'POST /stock/transfers/transfer/confirm': reply({ status: 'disputed' }),
    });
    expect(await screen.findByText('Algiers')).toBeVisible();
    await user.click(await screen.findByRole('button', { name: 'Deliver' }));
    expect(await screen.findByText('Gift delivered')).toBeVisible();
    await user.click(await screen.findByRole('button', { name: /Review receipt/ }));
    const received = screen.getByRole('spinbutton');
    expect(received).toHaveValue(40);
    await user.clear(received);
    await user.type(received, '38');
    expect(screen.getByText(/opens a dispute/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Confirm receipt' }));
    expect(await screen.findByText('Receipt recorded. A dispute was opened.')).toBeVisible();
    expect(api.calls.find(({ key }) => key.endsWith('/confirm')).body.lines).toEqual([
      { stockItemId: ids.gift, quantityReceived: 38 },
    ]);
  },
);

it.each([
  [{ ...day, field: null, nextAssignmentDate: '2026-11-21' }, 'Next assignment on 2026-11-21'],
  [
    { ...day, field: { ...day.field, closedReason: 'campaign_not_active' } },
    'Field entry is closed because the campaign is not active.',
  ],
])('explains unavailable field entry', { timeout: 20000 }, async (answer, message) => {
  start('/field', { 'GET /me/sales/today': reply(answer) });
  expect(await screen.findByText(message)).toBeVisible();
});

it(
  'requires photo and GPS, offers permission recovery, and displays a late server result',
  { timeout: 20000 },
  async () => {
    const getCurrentPosition = vi
      .fn()
      .mockImplementationOnce((_done, deny) => deny({ code: 1 }))
      .mockImplementationOnce((done) =>
        done({ coords: { latitude: 36.7, longitude: 3.05, accuracy: 24 } }),
      );
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:photo', revokeObjectURL: () => {} }),
    );
    const user = start('/field/attendance', {
      ['POST /assignments/' + ids.assignment + '/attendance']: reply({
        recordedAt: '2026-11-20T08:50:00Z',
        isLate: true,
        distanceM: 1800,
        flags: ['late', 'far_from_pos'],
      }),
    });
    const photo = await screen.findByLabelText(/Photo/);
    expect(photo).toHaveAttribute('capture', 'environment');
    expect(screen.getByRole('button', { name: 'Record attendance' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Get location' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Site settings');
    await user.click(screen.getByRole('button', { name: 'Get location' }));
    expect(await screen.findByText('Location accuracy 24 m')).toBeVisible();
    await user.upload(photo, new File(['camera'], 'camera.jpg', { type: 'image/jpeg' }));
    await user.click(screen.getByRole('button', { name: 'Record attendance' }));
    expect(await screen.findByText(/1.8 km from the store/)).toBeVisible();
    expect(screen.getByText(/09:50/)).toBeVisible();
    expect(getCurrentPosition.mock.calls[1][2]).toEqual({
      enableHighAccuracy: true,
      timeout: 15000,
    });
  },
);

it(
  'previews gifts, validates required customer fields and retries exactly the same sale',
  { timeout: 20000 },
  async () => {
    let attempts = 0;
    const user = start('/field/sale', {
      [salePath]: (config) =>
        ++attempts === 1
          ? networkError(config)
          : reply({
              entitlements: [
                { id: 'a', stockItem: { name: 'Mug' }, status: 'distributed', quantity: 1 },
                { id: 'b', stockItem: { name: 'Cap' }, status: 'undelivered', quantity: 1 },
              ],
              tombolaEntries: [{ tombolaId: 'draw', tombola: 'Demo Tombola', numbers: [1042] }],
              skippedPromotions: [],
            })(),
      ['POST /assignments/' + ids.assignment + '/interactions']: reply({
        kind: 'sample',
        count: 2,
      }),
    });
    const increment = await screen.findByRole('button', { name: 'Increase Juice' });
    for (let i = 0; i < 3; i++) await user.click(increment);
    expect(await screen.findByText('Expected gifts')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Record sale' }));
    expect(await screen.findAllByText('Complete the required customer field.')).toHaveLength(3);
    await user.type(screen.getByLabelText(/Full name/), 'Karim Benali');
    await user.type(screen.getByLabelText(/Mobile number/), '0550123456');
    await user.click(screen.getByRole('checkbox', { name: /customer consents/ }));
    await user.click(screen.getByRole('button', { name: 'Record sale' }));
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('1042')).toBeVisible();
    expect(screen.getByText('Cap × 1')).toBeVisible();
    const sales = api.calls.filter(({ key }) => key === salePath);
    expect(sales[1].idempotencyKey).toBe(sales[0].idempotencyKey);
    expect(sales[1].body).toEqual(sales[0].body);
    expect(sessionStorage.length).toBe(0);
    await user.click(screen.getByRole('button', { name: 'No-purchase interaction' }));
    await user.click(screen.getByRole('button', { name: 'Increase Count' }));
    await user.click(screen.getByRole('button', { name: 'Record interaction' }));
    expect(await screen.findByText('Interaction recorded')).toBeVisible();
  },
);

it(
  'creates a stock shortage issue and refreshes the open issues list',
  { timeout: 20000 },
  async () => {
    let created = false;
    const issue = { id: 'one', title: 'No mugs left', status: 'open' };
    const user = start('/field/issue', {
      'POST /issues': () => {
        created = true;
        return [201, { data: issue }];
      },
      'GET /issues': (config) => reply(created && config.params.status === 'open' ? [issue] : [])(),
    });
    await user.type(await screen.findByLabelText('Title'), issue.title);
    await user.selectOptions(screen.getByLabelText(/Stock item/), ids.gift);
    await user.click(screen.getByRole('button', { name: 'Send issue' }));
    expect(await screen.findByText('No mugs left')).toBeVisible();
    expect(api.calls.find(({ key }) => key === 'POST /issues').idempotencyKey).toBeTruthy();
  },
);

it.each([
  ['/field', 'اليوم'],
  ['/field/attendance', 'الحضور'],
  ['/field/sale', 'البيع'],
  ['/field/issue', 'بلاغ'],
])(
  'renders an accessible Arabic shell at 360 px on %s',
  { timeout: 20000 },
  async (path, title) => {
    vi.stubGlobal('innerWidth', 360);
    start(path, {}, 'ar');
    const heading = await screen.findByRole('heading', { name: title, level: 1 });
    const shell = heading.closest('[dir]');
    expect(shell.getAttribute('dir')).toBe('rtl');
    expect(shell.getAttribute('lang')).toBe('ar');
    const nav = within(shell).getByRole('navigation');
    expect(
      within(nav)
        .getAllByRole('link')
        .map((item) => [item.textContent, item.classList.contains('min-h-14')]),
    ).toMatchInlineSnapshot(`
      [
        [
          "اليوم",
          true,
        ],
        [
          "الحضور",
          true,
        ],
        [
          "البيع",
          true,
        ],
        [
          "بلاغ",
          true,
        ],
      ]
    `);
    await waitFor(() =>
      expect(within(nav).getByRole('link', { name: title })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
  },
);
