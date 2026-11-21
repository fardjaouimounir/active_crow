import { ROLE_PERMISSIONS } from '@fieldflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { resetSessionForTests } from '../src/shared/auth/session.js';
import i18n from '../src/shared/i18n/index.js';
import { makeUser, mockApi, sessionFor } from './helpers/mockApi.js';
import { renderApp } from './helpers/renderApp.jsx';

const id = '98881111-1111-4111-8111-111111111111';
const campaignId = '98882222-1111-4111-8111-111111111111';
const issuePath = '/issues/' + id;
const data = (value) => [200, { data: value }];
const page = (value) => [
  200,
  { data: value, meta: { page: 1, pageSize: 25, total: value.length } },
];
const notification = {
  id,
  type: 'assignment.proposed',
  entityType: 'assignment',
  entityId: id,
  payload: { campaignId },
  createdAt: '2026-11-20T08:00:00Z',
  readAt: null,
};
const issue = {
  id,
  title: 'Out of gifts',
  description: 'Please restock',
  category: 'stock_shortage',
  status: 'in_progress',
  version: 2,
  campaign: { id: campaignId, name: 'Demo Campaign' },
  pointOfSale: { name: 'Demo store' },
  reportedBy: { id, fullName: 'Reporter' },
  reportedById: id,
  assignedTo: null,
  attachments: [],
};
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
    'GET /auth/me': () => data({ user, permissions: ROLE_PERMISSIONS[role] }),
    'GET /notifications/unread-count': () => data({ count: 1 }),
    'GET /notifications': () => page([notification]),
    ['POST /notifications/' + id + '/read']: () => data({ count: 1 }),
    'GET /assignments/pending': () => page([]),
    ['GET ' + issuePath]: () => data(issue),
    ['GET ' + issuePath + '/comments']: () => data([]),
    'GET /campaigns': () => page([]),
    'GET /reference/wilayas': () => data([]),
    'GET /announcements': () => page([]),
    'GET /announcements/audience-preview': () => data({ count: 3 }),
    ...handlers,
  });
  return api;
}
afterEach(async () => {
  api?.restore();
  resetSessionForTests();
  await i18n.changeLanguage('en');
});

it('opens the bell, marks a proposed assignment read and jumps to Approvals', async () => {
  const client = stub('regional_manager');
  const user = userEvent.setup();
  const view = renderApp('/app/issues/' + id);
  await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
  await user.click(await screen.findByRole('link', { name: /New assignment awaiting approval/ }));
  await waitFor(() => expect(view.location()).toBe('/app/approvals'));
  expect(client.count('POST /notifications/' + id + '/read')).toBe(1);
});

it('renders RTL issue details and only shows management controls to an eligible role', async () => {
  await i18n.changeLanguage('ar');
  stub('general_manager');
  renderApp('/app/issues/' + id);
  await screen.findByRole('heading', { name: 'Out of gifts' });
  expect({
    direction: document.documentElement.dir,
    status: screen.getByText('قيد المعالجة').textContent,
    category: screen.getByText('نقص المخزون').textContent,
    action: screen.queryByRole('button', { name: 'حل البلاغ' })?.textContent ?? null,
  }).toMatchInlineSnapshot(`
   {
     "action": "حل البلاغ",
     "category": "نقص المخزون",
     "direction": "rtl",
     "status": "قيد المعالجة",
   }
 `);
});
it('shows issue resolution to a supervisor', async () => {
  stub('supervisor');
  renderApp('/app/issues/' + id);
  expect(await screen.findByRole('button', { name: 'Resolve' })).toBeInTheDocument();
});
it('loads the audience count when composing an announcement', async () => {
  stub('director');
  const user = userEvent.setup();
  renderApp('/app/announcements');
  await user.click(await screen.findByRole('button', { name: 'Write announcement' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.click(dialog.getByRole('button', { name: 'Superviseur', pressed: false }));
  expect(await dialog.findByText('Recipients: 3')).toBeInTheDocument();
});
