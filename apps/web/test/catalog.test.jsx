import { ROLE_PERMISSIONS } from '@fieldflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { formatMoney } from '../src/features/catalog/money.js';
import { resetSessionForTests } from '../src/shared/auth/session.js';
import i18n from '../src/shared/i18n/index.js';
import { apiError, makeUser, mockApi, sessionFor } from './helpers/mockApi.js';
import { renderApp } from './helpers/renderApp.jsx';

const clientId = '77111111-1111-4111-8111-111111111111';
const client = {
  id: clientId,
  name: 'Henkel Algérie',
  legalName: null,
  contactName: 'Karim',
  contactEmail: null,
  contactPhone: null,
  counts: { products: 1, stockItems: 0, portalUsers: 0 },
  createdAt: '2026-11-20T00:00:00Z',
  updatedAt: '2026-11-20T00:00:00Z',
};
const product = {
  id: '88111111-1111-4111-8111-111111111111',
  clientId,
  sku: 'DET-1KG',
  name: 'Detergent 1 kg',
  unitLabel: 'bag',
  referencePrice: '1250.50',
};
const page = (data) => [200, { data, meta: { page: 1, pageSize: 25, total: data.length } }];
let api;

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
}

function stub(role, handlers = {}) {
  const user = makeUser({ role });
  api = mockApi({
    'POST /auth/refresh': () => [200, sessionFor(user)],
    'GET /auth/me': () => [200, { data: { user, permissions: ROLE_PERMISSIONS[role] } }],
    'GET /clients': () => page([client]),
    ['GET /clients/' + clientId]: () => [200, { data: client }],
    ['GET /clients/' + clientId + '/products']: () => page([product]),
    ['GET /clients/' + clientId + '/stock-items']: () => page([]),
    ['GET /clients/' + clientId + '/users']: () => page([]),
    ...handlers,
  });
  return api;
}

afterEach(async () => {
  api?.restore();
  resetSessionForTests();
  await i18n.changeLanguage('en');
});

describe('client catalog', () => {
  it('lists clients with counts and opens the detail tabs', async () => {
    stub('director');
    const user = userEvent.setup();
    const view = renderApp('/app/clients');
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Karim')).toBeInTheDocument();
    expect(within(screen.getByRole('navigation')).getByText('Clients')).toBeInTheDocument();
    await user.click(within(table).getByRole('link', { name: client.name }));
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Overview',
      'Products',
      'Gifts & samples',
      'Portal accounts',
    ]);
    expect(screen.getByLabelText('Name')).toHaveValue(client.name);
    await user.click(screen.getByRole('tab', { name: 'Gifts & samples' }));
    await waitFor(() =>
      expect(view.location()).toBe('/app/clients/' + clientId + '?tab=stockItems'),
    );
    expect(await screen.findByText('No results.')).toBeInTheDocument();
  });

  it('creates a product in a modal and normalises a localised price', async () => {
    const calls = stub('director', {
      ['POST /clients/' + clientId + '/products']: () => [201, { data: product }],
    });
    const user = userEvent.setup();
    renderApp('/app/clients/' + clientId + '?tab=products');
    await user.click(await screen.findByRole('button', { name: 'New product' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('SKU'), 'det-1kg');
    await user.type(within(dialog).getByLabelText('Name'), 'Detergent 1 kg');
    await user.type(within(dialog).getByLabelText('Unit'), 'bag');
    await user.type(within(dialog).getByLabelText('Reference price (DZD)'), '1 250,50');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText('Changes saved.');
    const post = calls.calls.find(({ key }) => key === 'POST /clients/' + clientId + '/products');
    expect(post.body).toEqual({
      sku: 'DET-1KG',
      name: 'Detergent 1 kg',
      unitLabel: 'bag',
      referencePrice: '1250.50',
    });
  });

  it('explains why an in-use product cannot be deleted', async () => {
    stub('director', {
      ['DELETE /clients/' + clientId + '/products/' + product.id]: () =>
        apiError(422, 'PRODUCT_IN_USE'),
    });
    const user = userEvent.setup();
    renderApp('/app/clients/' + clientId + '?tab=products');
    await user.click(await screen.findByRole('button', { name: 'Delete ' + product.name }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This product cannot be deleted: it is linked to a campaign that is not closed or cancelled.',
    );
  });

  it('formats reference prices in DZD for English and Arabic', async () => {
    expect(formatMoney('1250.50', 'en')).toBe(
      new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'DZD' }).format(1250.5),
    );
    expect(formatMoney('1250.50', 'en')).toContain('1,250.50');
    expect(formatMoney('1250.50', 'ar')).toBe(
      new Intl.NumberFormat('ar-DZ', { style: 'currency', currency: 'DZD' }).format(1250.5),
    );
    expect(formatMoney(null, 'en')).toBe('—');
    stub('supervisor');
    await i18n.changeLanguage('ar');
    renderApp('/app/clients/' + clientId + '?tab=products');
    const table = await screen.findByRole('table');
    const price = formatMoney('1250.50', 'ar');
    expect(
      within(table).getByText((_, element) => element?.textContent === price, { selector: 'bdi' }),
    ).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.queryByRole('button', { name: 'منتج جديد' })).toBeNull();
  });

  it('creates a portal account and shows its temporary password once', async () => {
    const password = 'Temp_password_42';
    const calls = stub('director', {
      'POST /users': () => [
        201,
        { data: { user: { id: 'u-1', role: 'client' }, temporaryPassword: password } },
      ],
    });
    const user = userEvent.setup();
    renderApp('/app/clients/' + clientId + '?tab=portal');
    await user.click(await screen.findByRole('button', { name: 'New portal account' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Full name'), 'Portal User');
    await user.type(within(dialog).getByLabelText('Email'), 'portal@henkel.dz');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByDisplayValue(password)).toBeInTheDocument();
    expect(calls.calls.find(({ key }) => key === 'POST /users').body).toEqual({
      role: 'client',
      clientId,
      fullName: 'Portal User',
      email: 'portal@henkel.dz',
      phone: null,
    });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByDisplayValue(password)).toBeNull();
  });
});
