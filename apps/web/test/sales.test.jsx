import { ROLE_PERMISSIONS } from '@fieldflow/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { resetSessionForTests } from '../src/shared/auth/session.js';
import i18n from '../src/shared/i18n/index.js';
import { makeUser, mockApi, sessionFor } from './helpers/mockApi.js';
import { renderApp } from './helpers/renderApp.jsx';

const campaignId = '99111111-1111-4111-8111-111111111111';
const id = '78111111-1111-4111-8111-111111111111';
const campaign = {
  id: campaignId,
  code: 'CMP-2026-004',
  name: 'Demo sale',
  status: 'draft',
  startDate: '2026-11-20',
  endDate: '2026-11-30',
  pointsOfSale: [],
  products: [],
};
const sale = {
  id,
  status: 'recorded',
  workDate: '2026-11-20',
  units: 3,
  animateur: { fullName: 'Karim' },
  pointOfSale: { name: 'Test store' },
  customer: { fullName: 'K. B.', phone: '+213 5•• •• •• 56' },
  items: [{ id: 'line-1', product: { name: 'Juice' }, quantity: 3 }],
  entitlements: [
    {
      id: 'gift-1',
      stockItem: { name: 'Mug' },
      promotion: { name: 'Tiered gift' },
      quantity: 1,
      status: 'distributed',
      deliveryMovementId: 'movement-1',
    },
  ],
  tombolaEntries: [
    { id: 'entry-1', tombola: { name: 'Grand tirage' }, entryNumber: 1042, status: 'valid' },
  ],
};
const response = (data, meta) => () => [200, { data, ...(meta ? { meta } : {}) }];
let api;
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
  }
});
afterEach(() => {
  api?.restore();
  resetSessionForTests();
});

function open(tab, role = 'director') {
  const user = makeUser({ role });
  api = mockApi({
    'POST /auth/refresh': () => [200, sessionFor(user)],
    'GET /auth/me': response({ user, permissions: ROLE_PERMISSIONS[role] }),
    [`GET /campaigns/${campaignId}`]: response(campaign),
    [`GET /campaigns/${campaignId}/sales`]: response([sale], {
      page: 1,
      pageSize: 50,
      total: 1,
      counts: { sales: 1, buyers: 1, units: 3, undelivered: 0 },
    }),
    [`GET /sales/${id}`]: response(sale),
    [`POST /sales/${id}/void`]: response({ ...sale, status: 'voided' }),
    [`GET /campaigns/${campaignId}/tombolas`]: response([]),
    [`POST /campaigns/${campaignId}/tombolas`]: response({ id }),
  });
  renderApp(`/app/campaigns/${campaignId}?tab=${tab}`);
  return userEvent.setup();
}

it(
  'shows product, gift, delivery movement and Tombola entry before voiding a sale',
  { timeout: 20_000 },
  async () => {
    const user = open('sales', 'supervisor');
    await user.click(await screen.findByRole('button', { name: '2026-11-20' }));
    const drawer = within(await screen.findByRole('dialog'));
    expect(await drawer.findByText('Juice × 3')).toBeVisible();
    expect(drawer.getByText(/Mug × 1/)).toBeVisible();
    expect(drawer.getByText('movement-1')).toBeVisible();
    expect(drawer.getByText('1042')).toBeVisible();
    await user.click(drawer.getByRole('button', { name: 'Void sale' }));
    await user.type(drawer.getByLabelText('Reason'), 'Sale entered twice');
    await user.click(drawer.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.count(`POST /sales/${id}/void`)).toBe(1));
  },
);

it('uses Arabic table headers and right-to-left direction', { timeout: 20_000 }, async () => {
  await i18n.changeLanguage('ar');
  open('sales');
  const table = await screen.findByRole('table');
  expect(document.documentElement.dir).toBe('rtl');
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((node) => node.textContent),
  ).toMatchInlineSnapshot(`
      [
        "التاريخ",
        "المنشط",
        "نقطة البيع",
        "الوحدات",
        "الحالة",
      ]
    `);
});

it(
  'rejects a draw before registration closes and submits a corrected Tombola schedule',
  { timeout: 20_000 },
  async () => {
    const user = open('tombola');
    await user.click(await screen.findByRole('button', { name: 'New Tombola' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText('Name'), 'Grand tirage');
    fireEvent.change(dialog.getByLabelText('Registration ends (Algiers time)'), {
      target: { value: '2026-11-28T14:00' },
    });
    fireEvent.change(dialog.getByLabelText('Draw scheduled (Algiers time)'), {
      target: { value: '2026-11-28T12:00' },
    });
    await user.click(dialog.getByRole('button', { name: 'Confirm' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('The draw must follow registration');
    expect(api.count(`POST /campaigns/${campaignId}/tombolas`)).toBe(0);
    fireEvent.change(dialog.getByLabelText('Draw scheduled (Algiers time)'), {
      target: { value: '2026-11-28T15:00' },
    });
    await user.click(dialog.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.count(`POST /campaigns/${campaignId}/tombolas`)).toBe(1));
    expect(
      api.calls.find((call) => call.key === `POST /campaigns/${campaignId}/tombolas`).body,
    ).toMatchObject({
      registrationEndsAt: '2026-11-28T13:00:00.000Z',
      drawScheduledAt: '2026-11-28T14:00:00.000Z',
    });
  },
);
