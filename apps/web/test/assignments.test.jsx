import { ROLE_PERMISSIONS, today } from '@fieldflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { resetSessionForTests } from '../src/shared/auth/session.js';
import i18n from '../src/shared/i18n/index.js';
import { makeUser, mockApi, sessionFor } from './helpers/mockApi.js';
import { renderApp } from './helpers/renderApp.jsx';

const id = '99111111-1111-4111-8111-111111111111';
const point = { id: '77111111-1111-4111-8111-111111111111', name: 'Central Shop', wilayaId: 16 };
const first = { id: '66111111-1111-4111-8111-111111111111', fullName: 'Amina', available: true };
const second = {
  id: '55111111-1111-4111-8111-111111111111',
  fullName: 'Karim',
  available: false,
  conflict: { startDate: '2027-02-12', endDate: '2027-02-20' },
};
const row = {
  id: '44111111-1111-4111-8111-111111111111',
  campaignId: id,
  campaign: { id, name: 'Demo campaign' },
  animateur: first,
  supervisor: { id, fullName: 'Supervisor' },
  pointOfSale: point,
  startDate: '2027-02-10',
  endDate: '2027-02-25',
  status: 'proposed',
};
const base = '/campaigns/' + id;
const area = {
  wilayaId: 16,
  wilaya: { nameEn: 'Algiers', nameAr: 'الجزائر' },
  requiredAnimateurs: 3,
};
const result = (data) => [200, { data }];
const page = (data) => [200, { data, meta: { total: data.length, page: 1, pageSize: 25 } }];
let api;

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
}

function stub(role, extra = {}) {
  const user = makeUser({ role });
  const campaign = {
    id,
    code: 'CMP-2027-001',
    name: 'Demo campaign',
    assignmentApproverRole: 'regional_manager',
    status: 'assigned',
    startDate: today(),
    endDate: '2099-03-12',
    counts: {},
    wilayas: [{ ...area, staff: [{ role, user }] }],
    pointsOfSale: [point],
  };
  api = mockApi({
    'POST /auth/refresh': () => [200, sessionFor(user)],
    'GET /auth/me': () => result({ user, permissions: ROLE_PERMISSIONS[role] }),
    ['GET ' + base]: () => result(campaign),
    ['GET ' + base + '/assignments']: () => page([row]),
    ['GET ' + base + '/staffing']: () =>
      result([{ ...area, approvedAnimateurs: 1, proposedCount: 1, uncoveredPointsOfSale: [] }]),
    ['GET ' + base + '/assignment-candidates']: () => result([first, second]),
    'GET /assignments/pending': () => page([row]),
    ...extra,
  });
  return api;
}

afterEach(async () => {
  api?.restore();
  resetSessionForTests();
  await i18n.changeLanguage('en');
});

it('shows unavailable candidates and renders indexed batch errors beside the proposals', async () => {
  const client = stub('supervisor', {
    ['POST ' + base + '/assignments/batch']: () => [
      409,
      {
        error: {
          code: 'ASSIGNMENT_OVERLAP',
          details: { items: [{ index: 0, code: 'ASSIGNMENT_OVERLAP' }] },
        },
      },
    ],
  });
  const user = userEvent.setup();
  renderApp('/app' + base + '?tab=assignments');
  await user.click(await screen.findByRole('button', { name: 'Propose assignment' }));
  const modal = within(screen.getByRole('dialog'));
  expect(await modal.findByRole('option', { name: /Unavailable from 2027-02-12/ })).toBeDisabled();
  await user.selectOptions(modal.getByLabelText('Point de Vente'), point.id);
  await user.selectOptions(modal.getByLabelText('Animateur'), first.id);
  await user.click(modal.getByRole('button', { name: 'Add to batch' }));
  await user.click(await modal.findByRole('button', { name: 'Submit 1 proposals' }));
  const item = modal.getByRole('listitem');
  expect(await within(item).findByRole('alert')).toHaveTextContent('overlapping assignment');
  expect(client.calls.find(({ key }) => key.endsWith('/assignments/batch')).body).toEqual([
    expect.objectContaining({ animateurId: first.id }),
  ]);
});

it('submits a bulk rejection with a note from the Approvals inbox', async () => {
  const client = stub('regional_manager', { 'POST /assignments/decisions': () => result([row]) });
  const user = userEvent.setup();
  renderApp('/app/approvals');
  await user.click(await screen.findByRole('checkbox', { name: /Amina/ }));
  await user.click(screen.getByRole('button', { name: 'Reject' }));
  const modal = within(screen.getByRole('dialog'));
  await user.type(modal.getByLabelText('Reason'), 'Unavailable');
  await user.click(modal.getByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(client.calls.find(({ key }) => key === 'POST /assignments/decisions')?.body).toEqual([
      { id: row.id, decision: 'reject', note: 'Unavailable' },
    ]),
  );
});

it('renders the Assignments tab in Arabic and RTL', async () => {
  await i18n.changeLanguage('ar');
  stub('supervisor');
  renderApp('/app' + base + '?tab=assignments');
  const table = within(await screen.findByRole('table'));
  expect({
    direction: document.documentElement.dir,
    tab: screen.getByRole('tab', { name: 'التعيينات' }).textContent,
    headers: table.getAllByRole('columnheader').map((item) => item.textContent),
    status: table.getByText('مقترح').textContent,
  }).toMatchInlineSnapshot(`
    {
      "direction": "rtl",
      "headers": [
        "منشط",
        "نقطة البيع",
        "المشرف",
        "الفترة",
        "الحالة",
        "الإجراءات",
      ],
      "status": "مقترح",
      "tab": "التعيينات",
    }
  `);
});
