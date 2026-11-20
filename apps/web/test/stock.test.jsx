import { ROLE_PERMISSIONS } from '@fieldflow/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ReconciliationTable } from '../src/features/inventory/StockViews.jsx';
import { resetSessionForTests } from '../src/shared/auth/session.js';
import i18n from '../src/shared/i18n/index.js';
import { apiError, makeUser, mockApi, sessionFor } from './helpers/mockApi.js';
import { renderApp } from './helpers/renderApp.jsx';

const id = '99111111-1111-4111-8111-111111111111';
const gift = '55111111-1111-4111-8111-111111111111';
const supervisor = {
  kind: 'user',
  userId: '66111111-1111-4111-8111-111111111111',
  fullName: 'Samia Superviseur',
  role: 'supervisor',
};
const campaign = {
  id,
  code: 'CMP-2027-001',
  name: 'Ramadan 2027',
  description: null,
  status: 'active',
  startDate: '2027-02-10',
  endDate: '2027-03-12',
  budgetAmount: null,
  assignmentApproverRole: 'regional_manager',
  version: 1,
  client: { id: '77111111-1111-4111-8111-111111111111', name: 'Hamoud' },
  wilayas: [],
  pointsOfSale: [],
  products: [],
  counts: {
    wilayas: 0,
    requiredAnimateurs: 0,
    staff: 0,
    pointsOfSale: 0,
    products: 0,
    documents: 0,
  },
};
const balances = {
  items: [{ id: gift, sku: 'MUG', name: 'Mug', kind: 'gift', unitLabel: 'unit' }],
  locations: [
    {
      id: 'l1',
      kind: 'warehouse',
      userId: null,
      fullName: null,
      role: null,
      quantities: { [gift]: 100 },
      total: 100,
    },
    {
      id: 'l2',
      kind: 'holder',
      userId: supervisor.userId,
      fullName: supervisor.fullName,
      role: 'supervisor',
      quantities: { [gift]: 55 },
      total: 55,
    },
    {
      id: 'l3',
      kind: 'losses',
      userId: null,
      fullName: null,
      role: null,
      quantities: { [gift]: 5 },
      total: 5,
    },
  ],
  totals: { quantities: { [gift]: 160 }, total: 160 },
};
const result = (data) => [200, { data }];
let api;

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
}

function stub(role, handlers = {}, overrides = {}) {
  const user = makeUser({ role, ...overrides });
  api = mockApi({
    'POST /auth/refresh': () => [200, sessionFor(user)],
    'GET /auth/me': () => result({ user, permissions: ROLE_PERMISSIONS[role] }),
    ['GET /campaigns/' + id]: () => result(campaign),
    ['GET /campaigns/' + id + '/stock/balances']: () => result(balances),
    ['GET /campaigns/' + id + '/stock/recipients']: () => result([supervisor]),
    ...handlers,
  });
  return api;
}

afterEach(async () => {
  api?.restore();
  resetSessionForTests();
  await i18n.changeLanguage('en');
});

describe('stock tab', () => {
  it(
    'transfer form offers only valid recipients and shows the available quantity',
    { timeout: 20_000 },
    async () => {
      const calls = stub('director', {
        ['POST /campaigns/' + id + '/stock/transfers']: () => [201, { data: { id: 'm1' } }],
      });
      const user = userEvent.setup();
      renderApp('/app/campaigns/' + id + '?tab=stock');
      await screen.findByRole('table');
      await user.click(screen.getByRole('button', { name: 'Transfer' }));
      const dialog = screen.getByRole('dialog');
      const options = await within(dialog).findAllByRole('option', { name: supervisor.fullName });
      expect(options).toHaveLength(1);
      expect(within(dialog).queryByRole('option', { name: 'Rachid Regional' })).toBeNull();
      await user.selectOptions(within(dialog).getByLabelText('Recipient'), supervisor.userId);
      await user.selectOptions(within(dialog).getByLabelText('Item'), gift);
      expect(within(dialog).getByText('Available: 100')).toBeInTheDocument();
      await user.clear(within(dialog).getByLabelText('Quantity'));
      await user.type(within(dialog).getByLabelText('Quantity'), '40');
      await user.click(within(dialog).getByRole('button', { name: 'Submit' }));
      await waitFor(() =>
        expect(calls.count('POST /campaigns/' + id + '/stock/transfers')).toBe(1),
      );
      const sent = calls.calls.find(({ key }) => key.endsWith('/stock/transfers'));
      expect(sent.body).toEqual({
        recipientUserId: supervisor.userId,
        lines: [{ stockItemId: gift, quantity: 40 }],
      });
      expect(sent.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it(
    'shows the available quantity when the server refuses a transfer',
    { timeout: 20_000 },
    async () => {
      stub('director', {
        ['POST /campaigns/' + id + '/stock/transfers']: () => [
          422,
          {
            error: {
              code: 'INSUFFICIENT_STOCK',
              message: 'x',
              details: { available: 100, requested: 150 },
            },
          },
        ],
      });
      const user = userEvent.setup();
      renderApp('/app/campaigns/' + id + '?tab=stock');
      await screen.findByRole('table');
      await user.click(screen.getByRole('button', { name: 'Transfer' }));
      const dialog = screen.getByRole('dialog');
      await within(dialog).findByRole('option', { name: supervisor.fullName });
      await user.selectOptions(within(dialog).getByLabelText('Recipient'), supervisor.userId);
      await user.selectOptions(within(dialog).getByLabelText('Item'), gift);
      await user.clear(within(dialog).getByLabelText('Quantity'));
      await user.type(within(dialog).getByLabelText('Quantity'), '150');
      await user.click(within(dialog).getByRole('button', { name: 'Submit' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Not enough stock: 100 available, 150 requested.',
      );
    },
  );

  it('snapshots the balances matrix with totals', async () => {
    stub('director');
    renderApp('/app/campaigns/' + id + '?tab=stock');
    const table = await screen.findByRole('table');
    expect({
      headers: within(table)
        .getAllByRole('columnheader')
        .map((item) => item.textContent),
      rows: within(table)
        .getAllByRole('row')
        .map((row) =>
          within(row)
            .queryAllByRole('cell')
            .concat(within(row).queryAllByRole('rowheader'))
            .map((cell) => cell.textContent),
        ),
    }).toMatchInlineSnapshot(`
      {
        "headers": [
          "Location",
          "Mug",
          "Total",
        ],
        "rows": [
          [],
          [
            "100",
            "100",
            "Warehouse",
          ],
          [
            "55",
            "55",
            "Samia SuperviseurSuperviseur",
          ],
          [
            "5",
            "5",
            "Losses",
          ],
          [
            "160",
            "160",
            "Total",
          ],
        ],
      }
    `);
  });
});

describe('my stock', () => {
  const movement = {
    id: 'm1',
    type: 'transfer',
    status: 'pending',
    campaign: { id, name: 'Ramadan 2027' },
    from: { kind: 'warehouse', fullName: null },
    to: { kind: 'holder', fullName: 'Samia Superviseur' },
    lines: [{ stockItemId: gift, sku: 'MUG', name: 'Mug', quantity: 100, quantityReceived: null }],
  };

  it('a shortfall in the confirm modal is sent as the received quantity', async () => {
    const calls = stub(
      'supervisor',
      {
        'GET /me/stock': () =>
          result({
            balances: [],
            awaitingConfirmation: [movement],
            outgoing: [],
            approvals: { adjustments: [], disputes: [] },
          }),
        'POST /stock/transfers/m1/confirm': () => result({ ...movement, status: 'disputed' }),
      },
      { id: supervisor.userId },
    );
    const user = userEvent.setup();
    renderApp('/app/my-stock');
    await user.click(await screen.findByRole('button', { name: 'Confirm receipt' }));
    const dialog = screen.getByRole('dialog');
    const quantity = within(dialog).getByLabelText('Quantity');
    expect(quantity).toHaveValue(100);
    await user.clear(quantity);
    await user.type(quantity, '95');
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(calls.count('POST /stock/transfers/m1/confirm')).toBe(1));
    const sent = calls.calls.find(({ key }) => key.endsWith('/confirm'));
    expect(sent.body).toEqual({ lines: [{ stockItemId: gift, quantityReceived: 95 }] });
    expect(sent.idempotencyKey).toBeTruthy();
  });

  it('keeps the same key when retrying after a server failure', async () => {
    let attempts = 0;
    const calls = stub(
      'supervisor',
      {
        'GET /me/stock': () =>
          result({
            balances: [],
            awaitingConfirmation: [movement],
            outgoing: [],
            approvals: { adjustments: [], disputes: [] },
          }),
        'POST /stock/transfers/m1/confirm': () =>
          ++attempts === 1 ? apiError(503, 'INTERNAL_ERROR') : result(movement),
      },
      { id: supervisor.userId },
    );
    const user = userEvent.setup();
    renderApp('/app/my-stock');
    await user.click(await screen.findByRole('button', { name: 'Confirm receipt' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }));
    await within(dialog).findByRole('alert');
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(calls.count('POST /stock/transfers/m1/confirm')).toBe(2));
    const keys = calls.calls
      .filter(({ key }) => key.endsWith('/confirm'))
      .map((call) => call.idempotencyKey);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });
});

describe('reconciliation view', () => {
  const row = (extra) => ({
    locationId: 'l2',
    stockItemId: gift,
    name: 'Mug',
    holder: { kind: 'holder', fullName: 'Samia Superviseur' },
    received: 100,
    sent: 40,
    returned: 0,
    distributed: 0,
    adjusted: 0,
    balance: 60,
    inTransitFrom: 0,
    inTransitTo: 0,
    check: { ok: true, difference: 0 },
    ...extra,
  });

  it('highlights a failing check', () => {
    const bad = row({
      locationId: 'l3',
      holder: { kind: 'holder', fullName: 'Amine' },
      balance: 58,
      check: { ok: false, difference: -2 },
    });
    render(<ReconciliationTable report={{ ok: false, totals: null, rows: [row(), bad] }} />);
    const cells = document.querySelectorAll('[data-check]');
    expect([...cells].map((cell) => cell.dataset.check)).toEqual(['ok', 'failed']);
    expect(cells[1].closest('tr')).toHaveClass('bg-danger-soft');
    expect(screen.getByRole('alert')).toHaveTextContent('Mismatch 1');
  });
});
