import { evaluatePromotions, ROLE_PERMISSIONS } from '@fieldflow/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { resetSessionForTests } from '../src/shared/auth/session.js';
import i18n from '../src/shared/i18n/index.js';
import { apiError, makeUser, mockApi, sessionFor } from './helpers/mockApi.js';
import { renderApp } from './helpers/renderApp.jsx';

const id = '99111111-1111-4111-8111-111111111111';
const clientId = '77111111-1111-4111-8111-111111111111';
const rsId = '55111111-1111-4111-8111-111111111111';
const product = { id: 'p-1', sku: 'DET', name: 'Detergent' };
const GIFT_A = 'bbbbbbbb-0000-4000-8000-00000000000a';
const GIFT_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const GIFT_C = 'bbbbbbbb-0000-4000-8000-00000000000c';
const regional = { id: 'r-1', fullName: 'Rachid Regional', role: 'regional_manager' };

const campaignOf = (status = 'planning', over = {}) => ({
  id,
  code: 'CMP-2027-001',
  name: 'Ramadan 2027',
  description: null,
  status,
  startDate: '2027-02-10',
  endDate: '2027-03-12',
  budgetAmount: '2500000.00',
  assignmentApproverRole: 'regional_manager',
  version: 1,
  client: { id: clientId, name: 'Hamoud' },
  requiredAnimateurs: 3,
  wilayas: [
    {
      wilayaId: 16,
      requiredAnimateurs: 3,
      staff: [{ id: 'st-1', role: 'regional_manager', wilayaId: 16, user: regional }],
    },
  ],
  pointsOfSale: [],
  products: [product],
  counts: {
    wilayas: 1,
    requiredAnimateurs: 3,
    staff: 1,
    pointsOfSale: 0,
    products: 1,
    documents: 0,
  },
  ...over,
});

const tierOf = (tier, minQuantity, stockItemId, giftQuantity = 1) => ({
  id: 't' + tier,
  minQuantity,
  stockItemId,
  giftQuantity,
});
const tiered = {
  id: 'pr-1',
  type: 'tiered_gift',
  name: 'Buy more',
  maxPerCustomer: null,
  productId: 'p-1',
  tiers: [tierOf(1, 1, GIFT_A), tierOf(2, 2, GIFT_B), tierOf(3, 3, GIFT_C, 2)],
};
const gifts = [
  { id: GIFT_A, name: 'Mug', sku: 'A' },
  { id: GIFT_B, name: 'Bag', sku: 'B' },
  { id: GIFT_C, name: 'Cap', sku: 'C' },
];
const attendance = {
  checkpoints: [
    {
      code: 'morning',
      label: { ar: 'صباح', en: 'Morning' },
      window: ['08:30', '09:30'],
      photo: true,
      gps: false,
    },
  ],
  lateToleranceMinutes: 15,
  autoVerifyAfterHours: null,
  maxDistanceMeters: null,
};
const customerFields = { fullName: 'required', phone: 'optional', consentRequired: true };

const ruleSetOf = (over = {}) => ({
  id: rsId,
  version: 1,
  status: 'draft',
  effectiveFrom: null,
  approvedAt: null,
  approvedBy: null,
  source: 'manual',
  rules: {},
  promotions: [],
  ...over,
});
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

function stub({
  role = 'director',
  campaign = campaignOf(),
  ruleSet = ruleSetOf(),
  readiness,
  handlers,
} = {}) {
  const user = makeUser({ role });
  api = mockApi({
    'POST /auth/refresh': () => [200, sessionFor(user)],
    'GET /auth/me': () => result({ user, permissions: ROLE_PERMISSIONS[role] }),
    'GET /reference/wilayas': () => result([{ id: 16, nameEn: 'Algiers', nameAr: 'الجزائر' }]),
    ['GET /campaigns/' + id]: () => result(campaign),
    ['GET /campaigns/' + id + '/readiness']: () =>
      readiness ? result(readiness) : result({ status: campaign.status, actions: [] }),
    ['GET /campaigns/' + id + '/rule-sets']: () =>
      result([{ ...ruleSet, rules: undefined, promotions: undefined }]),
    ['GET /campaigns/' + id + '/rule-sets/' + rsId]: () => result(ruleSet),
    ['GET /clients/' + clientId + '/stock-items']: (config) =>
      result(config.params?.kind === 'gift' ? gifts : []),
    ['GET /clients/' + clientId + '/products']: () => result([product]),
    ['GET /campaigns/' + id + '/documents']: () => result([]),
    ...handlers,
  });
  return api;
}

afterEach(async () => {
  api?.restore();
  resetSessionForTests();
  await i18n.changeLanguage('en');
});

const section = (name) => screen.getByRole('heading', { name }).closest('section');

describe('rules editor', () => {
  it('shows client-side and server validation on the exact field', async () => {
    const calls = stub({
      handlers: {
        ['PUT /campaigns/' + id + '/rule-sets/' + rsId + '/rules/attendance']: () => [
          400,
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'invalid',
              details: [
                { path: 'body.maxDistanceMeters', message: 'Required when a checkpoint uses GPS' },
              ],
            },
          },
        ],
      },
    });
    const user = userEvent.setup();
    renderApp(`/app/campaigns/${id}?tab=rules`);
    await screen.findByRole('heading', { name: 'Attendance' });
    await user.click(within(section('Attendance')).getByRole('button', { name: 'Configure' }));
    const attendanceSection = section('Attendance');
    const to = within(attendanceSection).getByLabelText('To');
    fireEvent.change(to, { target: { value: '08:00' } });
    await user.click(within(attendanceSection).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(attendanceSection).getByLabelText('To')).toBeInvalid());
    expect(within(attendanceSection).getByLabelText('From')).toBeValid();
    expect(calls.count('PUT /campaigns/' + id + '/rule-sets/' + rsId + '/rules/attendance')).toBe(
      0,
    );

    fireEvent.change(within(attendanceSection).getByLabelText('To'), {
      target: { value: '09:30' },
    });
    await user.click(within(attendanceSection).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(within(attendanceSection).getByLabelText('Maximum distance (meters)')).toBeInvalid(),
    );
    expect(within(attendanceSection).getByLabelText('To')).toBeValid();
    const put = calls.calls.find(({ key }) => key.startsWith('PUT') && key.endsWith('/attendance'));
    expect(put.body.checkpoints[0]).toMatchObject({ code: 'morning', window: ['08:30', '09:30'] });
  });

  it('keeps the required rules and the approved version read-only', async () => {
    stub({
      ruleSet: ruleSetOf({
        status: 'approved',
        effectiveFrom: '2027-01-05T09:00:00Z',
        approvedAt: '2027-01-05T09:00:00Z',
        approvedBy: { id: 'u-1', fullName: 'Amina Benali' },
        rules: { attendance, customer_fields: customerFields },
      }),
    });
    renderApp(`/app/campaigns/${id}?tab=rules`);
    await screen.findByRole('heading', { name: 'Attendance' });
    expect(screen.getByText(/Approved by Amina Benali/)).toBeInTheDocument();
    expect(screen.getByText(/Approved versions never change/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create new version' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Uniform' })).toBeNull();
    expect(within(section('Attendance')).getByLabelText('Code')).toBeDisabled();
  });
});

describe('approval', () => {
  const approvePath = 'POST /campaigns/' + id + '/rule-sets/' + rsId + '/approve';

  it('summarises what is frozen and approves', async () => {
    const calls = stub({
      ruleSet: ruleSetOf({
        rules: { attendance, customer_fields: customerFields },
        promotions: [tiered],
      }),
      handlers: { [approvePath]: () => result(ruleSetOf({ status: 'approved' })) },
    });
    const user = userEvent.setup();
    renderApp(`/app/campaigns/${id}?tab=rules`);
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Attendance, Customer data/)).toBeInTheDocument();
    expect(within(dialog).getByText('1 promotion(s)')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Approve and apply' }));
    await waitFor(() => expect(calls.count(approvePath)).toBe(1));
  });

  it('blocks approval while required rules are missing, and shows the server verdict', async () => {
    const calls = stub({
      ruleSet: ruleSetOf({ rules: { customer_fields: customerFields } }),
    });
    const user = userEvent.setup();
    renderApp(`/app/campaigns/${id}?tab=rules`);
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Required rules are missing: Attendance.',
    );
    expect(within(dialog).getByRole('button', { name: 'Approve and apply' })).toBeDisabled();
    expect(calls.count(approvePath)).toBe(0);
  });

  it('lists what the server found invalid at approval', async () => {
    stub({
      ruleSet: ruleSetOf({ rules: { attendance, customer_fields: customerFields } }),
      handlers: {
        [approvePath]: () => [
          422,
          {
            error: {
              code: 'INVALID_RULE_CONFIG',
              message: 'invalid',
              details: {
                issues: [
                  {
                    scope: 'promotion',
                    code: 'GIFT_NOT_OF_CLIENT',
                    path: 'promotions.0.tiers.0.stockItemId',
                    message: 'x',
                  },
                ],
              },
            },
          },
        ],
      },
    });
    const user = userEvent.setup();
    renderApp(`/app/campaigns/${id}?tab=rules`);
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve and apply' }));
    expect(await within(dialog).findByText(/Choose an active gift item/)).toBeInTheDocument();
  });
});

describe('promotion preview', () => {
  it('shows the gifts the shared evaluation computes for the typed quantities', async () => {
    stub({ ruleSet: ruleSetOf({ promotions: [tiered] }) });
    const user = userEvent.setup();
    renderApp(`/app/campaigns/${id}?tab=rules`);
    const preview = await screen.findByRole('region', { name: 'Promotion preview' });
    expect(within(preview).getByText('No gift for this sale.')).toBeInTheDocument();
    const quantity = within(preview).getByLabelText('Detergent');
    const names = { [GIFT_A]: 'Mug (A)', [GIFT_B]: 'Bag (B)', [GIFT_C]: 'Cap (C)' };
    for (const units of [1, 2, 3, 9]) {
      await user.clear(quantity);
      await user.type(quantity, String(units));
      // The server evaluates with this very function; the panel must say the same.
      const [expected] = evaluatePromotions([tiered], [{ productId: 'p-1', quantity: units }]);
      await waitFor(() =>
        expect(preview).toHaveTextContent(
          `${expected.quantity} × ${names[expected.stockItemId]} — Buy more`,
        ),
      );
    }
    expect(within(preview).getByRole('status')).toHaveTextContent('2 × Cap (C)');
    await user.clear(quantity);
    expect(within(preview).getByText('No gift for this sale.')).toBeInTheDocument();
  });
});

describe('promotions editor', () => {
  it('adapts the tiers to the promotion type and maps server errors to their field', async () => {
    const path = 'PUT /campaigns/' + id + '/rule-sets/' + rsId + '/promotions';
    const calls = stub({
      handlers: {
        [path]: () => [
          422,
          {
            error: {
              code: 'PROMOTION_INVALID',
              message: 'invalid',
              details: {
                reason: 'TIERS_NOT_STRICTLY_INCREASING',
                path: 'body.promotions.0.tiers.1.minQuantity',
              },
            },
          },
        ],
      },
    });
    const user = userEvent.setup();
    renderApp(`/app/campaigns/${id}?tab=rules`);
    await user.click(await screen.findByRole('button', { name: 'Add promotion' }));
    const card = screen.getByRole('group', { name: 'Promotion 1' });
    expect(within(card).getAllByRole('group')).toHaveLength(1);
    expect(within(card).getByLabelText('From (units)')).toHaveAttribute('readonly');
    await user.selectOptions(within(card).getByLabelText('Type'), 'tiered_gift');
    expect(within(card).getAllByRole('group')).toHaveLength(2);
    await user.type(within(card).getByLabelText('Name'), 'Buy more');
    const [first, second] = within(card).getAllByRole('group');
    await within(first).findByRole('option', { name: 'Mug (A)' });
    await user.selectOptions(within(first).getByLabelText('Gift'), GIFT_A);
    await user.selectOptions(within(second).getByLabelText('Gift'), GIFT_B);
    await user.clear(within(second).getByLabelText('From (units)'));
    await user.type(within(second).getByLabelText('From (units)'), '1');
    await user.click(screen.getByRole('button', { name: 'Save promotions' }));
    await waitFor(() => expect(calls.count(path)).toBe(1));
    expect(
      await within(second).findByText('Each tier must need more units than the one before.'),
    ).toBeInTheDocument();
    expect(calls.calls.find(({ key }) => key === path).body.promotions[0]).toMatchObject({
      type: 'tiered_gift',
      productId: null,
      tiers: [
        { minQuantity: 1, stockItemId: GIFT_A, giftQuantity: 1 },
        { minQuantity: 1, stockItemId: GIFT_B, giftQuantity: 1 },
      ],
    });
  });
});

describe('lifecycle on the overview', () => {
  const readinessOf = (status, actions) => ({ status, actions });

  it('lists the blockers as actionable sentences and keeps blocked actions disabled', async () => {
    stub({
      campaign: campaignOf('planning'),
      readiness: readinessOf('planning', [
        {
          action: 'mark-assigned',
          to: 'assigned',
          allowed: false,
          reasonRequired: false,
          blockers: [
            { code: 'WILAYA_WITHOUT_SUPERVISOR', details: { wilayaIds: [16] } },
            { code: 'NO_POINT_OF_SALE' },
          ],
        },
        { action: 'cancel', to: 'cancelled', allowed: true, reasonRequired: true, blockers: [] },
      ]),
    });
    const user = userEvent.setup();
    const view = renderApp(`/app/campaigns/${id}`);
    expect(
      await screen.findByText(/Every wilaya needs a Superviseur\. Missing in: Algiers\./),
    ).toBeInTheDocument();
    expect(screen.getByText('Add at least one Point de Vente.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as assigned' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel campaign' })).toBeEnabled();
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Planning');
    const [fix] = screen.getAllByRole('link', { name: /Coverage/ });
    expect(fix).toHaveAttribute('href', expect.stringContaining('tab=coverage'));
    await user.click(fix);
    await waitFor(() => expect(view.location()).toContain('tab=coverage'));
  });

  it('asks for a reason of at least three characters before suspending', async () => {
    const path = 'POST /campaigns/' + id + '/suspend';
    const calls = stub({
      campaign: campaignOf('active'),
      readiness: readinessOf('active', [
        { action: 'suspend', to: 'suspended', allowed: true, reasonRequired: true, blockers: [] },
        { action: 'resume', to: 'active', allowed: true, reasonRequired: false, blockers: [] },
      ]),
      handlers: { [path]: () => result(campaignOf('suspended')) },
    });
    const user = userEvent.setup();
    renderApp(`/app/campaigns/${id}`);
    await user.click(await screen.findByRole('button', { name: 'Suspend' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
    await user.type(within(dialog).getByLabelText('Reason'), 'ab');
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Reason'), 'c from the client');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(calls.count(path)).toBe(1));
    expect(calls.calls.find(({ key }) => key === path).body).toEqual({
      reason: 'abc from the client',
    });
  });

  it('shows the server blockers when the transition is refused', async () => {
    const path = 'POST /campaigns/' + id + '/activate';
    stub({
      campaign: campaignOf('assigned'),
      readiness: readinessOf('assigned', [
        { action: 'activate', to: 'active', allowed: true, reasonRequired: false, blockers: [] },
      ]),
      handlers: {
        [path]: () => [
          422,
          {
            error: {
              code: 'TRANSITION_BLOCKED',
              message: 'blocked',
              details: { blockers: [{ code: 'NO_APPROVED_ASSIGNMENT' }] },
            },
          },
        ],
      },
    });
    const user = userEvent.setup();
    renderApp(`/app/campaigns/${id}`);
    await user.click(await screen.findByRole('button', { name: 'Activate' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(
      await within(dialog).findByText('The campaign is not ready for this action yet.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('At least one Animateur assignment must be approved.'),
    ).toBeInTheDocument();
  });

  it('marks a suspended or cancelled campaign distinctly and disables actions for non-directors', async () => {
    stub({
      role: 'supervisor',
      campaign: campaignOf('suspended'),
      readiness: readinessOf('suspended', [
        { action: 'resume', to: 'active', allowed: true, reasonRequired: false, blockers: [] },
      ]),
    });
    renderApp(`/app/campaigns/${id}`);
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeDisabled();
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Active');
    expect(screen.getAllByText('Suspended').length).toBeGreaterThan(0);
  });
});

describe('editing by status', () => {
  it('locks the start date and the approver of a running campaign but not its name or end date', async () => {
    stub({ campaign: campaignOf('active') });
    const user = userEvent.setup();
    renderApp(`/app/campaigns/${id}`);
    expect(await screen.findByLabelText('Name')).toBeEnabled();
    expect(screen.getByLabelText('End date')).toBeEnabled();
    expect(screen.getByLabelText('Start date')).toBeDisabled();
    expect(screen.getByLabelText('Start date')).toHaveAttribute(
      'title',
      'Locked while the campaign is Active.',
    );
    expect(screen.getByLabelText('Assignment approver')).toBeDisabled();
    await user.click(screen.getByRole('tab', { name: 'Products' }));
    const checkbox = await screen.findByRole('checkbox', { name: /Detergent/ });
    expect(checkbox).toBeDisabled();
    expect(checkbox).toHaveAttribute(
      'title',
      'Products cannot be removed while the campaign is running.',
    );
    await user.click(screen.getByRole('tab', { name: 'Coverage' }));
    expect(await screen.findByRole('button', { name: 'Add Superviseur' })).toBeInTheDocument();
  });

  it('shows a closed campaign read-only, with a note explaining why', async () => {
    stub({ campaign: campaignOf('closed') });
    const user = userEvent.setup();
    renderApp(`/app/campaigns/${id}`);
    await screen.findByRole('tab', { name: 'Coverage' });
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByLabelText('Name')).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Coverage' }));
    expect(await screen.findByRole('note')).toHaveTextContent('This campaign is Closed');
    expect(screen.queryByRole('button', { name: 'Add Superviseur' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Documents' }));
    await screen.findByText('No results.');
    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Rules' }));
    await screen.findByRole('heading', { name: 'Promotions' });
    expect(screen.queryByRole('button', { name: 'Create new version' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('keeps documents open for a completed campaign (final reports)', async () => {
    stub({ campaign: campaignOf('completed') });
    const user = userEvent.setup();
    renderApp(`/app/campaigns/${id}?tab=documents`);
    expect(await screen.findByRole('button', { name: 'Upload' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Coverage' }));
    expect(await screen.findByRole('note')).toBeInTheDocument();
  });

  it('surfaces a field-locked server refusal as a translated message', async () => {
    const path = 'PATCH /campaigns/' + id;
    stub({
      campaign: campaignOf('active'),
      handlers: { [path]: () => apiError(422, 'FIELD_NOT_EDITABLE_IN_STATUS') },
    });
    const user = userEvent.setup();
    renderApp(`/app/campaigns/${id}`);
    const name = await screen.findByLabelText('Name');
    await user.type(name, '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('This cannot be changed in the campaign’s current status.'),
    ).toBeInTheDocument();
  });
});
