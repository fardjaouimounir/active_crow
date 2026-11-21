import { ROLE_PERMISSIONS } from '@fieldflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { resetSessionForTests } from '../src/shared/auth/session.js';
import i18n from '../src/shared/i18n/index.js';
import { makeUser, mockApi, sessionFor } from './helpers/mockApi.js';
import { renderApp } from './helpers/renderApp.jsx';

const id = '99111111-1111-4111-8111-111111111111';
const clientX = { id: '77111111-1111-4111-8111-111111111111', name: 'Hamoud' };
const regional = { id: 'r-1', fullName: 'Rachid Regional', role: 'regional_manager' };
const supervisor = { id: 's-1', fullName: 'Samia Superviseur', role: 'supervisor' };
const campaign = {
  id,
  code: 'CMP-2027-001',
  name: 'Ramadan 2027',
  description: null,
  status: 'draft',
  startDate: '2027-02-10',
  endDate: '2027-03-12',
  budgetAmount: '2500000.00',
  assignmentApproverRole: 'regional_manager',
  version: 1,
  client: clientX,
  requiredAnimateurs: 3,
  wilayas: [
    {
      wilayaId: 16,
      requiredAnimateurs: 3,
      staff: [{ id: 'st-1', role: 'regional_manager', wilayaId: 16, user: regional }],
    },
  ],
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

function stub(role, handlers = {}) {
  const user = makeUser({ role });
  api = mockApi({
    'POST /auth/refresh': () => [200, sessionFor(user)],
    'GET /auth/me': () => result({ user, permissions: ROLE_PERMISSIONS[role] }),
    'GET /reference/wilayas': () => result([{ id: 16, nameEn: 'Algiers', nameAr: 'الجزائر' }]),
    'GET /clients': () => [200, { data: [clientX], meta: { page: 1, pageSize: 25, total: 1 } }],
    'GET /campaigns': () => [200, { data: [campaign], meta: { page: 1, pageSize: 25, total: 1 } }],
    ['GET /campaigns/' + id]: () => result(campaign),
    ['GET /campaigns/' + id + '/documents']: () => result([]),
    ['GET /campaigns/' + id + '/status-history']: () => result([]),
    'GET /users': ({ params }) => result(params.role === 'supervisor' ? [supervisor] : [regional]),
    ...handlers,
  });
  return api;
}

afterEach(async () => {
  api?.restore();
  resetSessionForTests();
  await i18n.changeLanguage('en');
});

describe('campaigns', () => {
  it('creates a draft campaign from the form', async () => {
    const calls = stub('director', { 'POST /campaigns': () => [201, { data: campaign }] });
    const user = userEvent.setup();
    const view = renderApp('/app/campaigns/new');
    await screen.findByRole('option', { name: clientX.name });
    await user.selectOptions(screen.getByLabelText('Client'), clientX.id);
    await user.type(screen.getByLabelText('Name'), 'Ramadan 2027');
    await user.type(screen.getByLabelText('Start date'), '2027-02-10');
    await user.type(screen.getByLabelText('End date'), '2027-03-12');
    await user.type(screen.getByLabelText('Budget (DZD)'), '2 500 000,00');
    expect(screen.getByLabelText('Assignment approver')).toHaveValue('regional_manager');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(view.location()).toBe('/app/campaigns/' + id));
    expect(calls.calls.find(({ key }) => key === 'POST /campaigns').body).toEqual({
      clientId: clientX.id,
      name: 'Ramadan 2027',
      description: null,
      startDate: '2027-02-10',
      endDate: '2027-03-12',
      budgetAmount: '2500000.00',
      assignmentApproverRole: 'regional_manager',
    });
  });

  it('adds and removes staff in the coverage tab', async () => {
    const calls = stub('director', {
      ['POST /campaigns/' + id + '/staff']: () => [201, { data: { id: 'st-2' } }],
      ['DELETE /campaigns/' + id + '/staff/st-1']: () => [204, undefined],
    });
    const user = userEvent.setup();
    renderApp('/app/campaigns/' + id + '?tab=coverage');
    expect(await screen.findByText(/Rachid Regional/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Responsable Régional' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Add Superviseur' }));
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByRole('option', { name: supervisor.fullName });
    await user.selectOptions(within(dialog).getByLabelText('Superviseur'), supervisor.id);
    // A supervisor comes with the number of Animateurs he must bring.
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Animateurs to bring'), '5');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.calls.find(({ key }) => key.startsWith('POST /campaigns/')).body).toEqual({
        userId: supervisor.id,
        wilayaId: 16,
        role: 'supervisor',
        requiredAnimateurs: 5,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Remove Rachid Regional' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(calls.count('DELETE /campaigns/' + id + '/staff/st-1')).toBe(1));
  });

  it('lets a supervisor pick an existing Animateur and create a new one for his team', async () => {
    const me = makeUser({ role: 'supervisor' });
    const mine = { id: 'a-1', fullName: 'Karim Animateur', role: 'animateur' };
    const teamCampaign = {
      ...campaign,
      status: 'planning',
      wilayas: [
        {
          wilayaId: 16,
          requiredAnimateurs: 3,
          wilaya: { nameEn: 'Algiers', nameAr: 'الجزائر' },
          staff: [
            {
              id: 'st-9',
              role: 'supervisor',
              wilayaId: 16,
              requiredAnimateurs: 3,
              teamCount: 1,
              user: { id: me.id, fullName: me.fullName, role: 'supervisor' },
            },
          ],
        },
      ],
    };
    const member = {
      id: 'tm-1',
      supervisorId: me.id,
      animateur: { id: 'a-0', fullName: 'Lina Already', status: 'active' },
    };
    const calls = stub('supervisor', {
      ['GET /campaigns/' + id]: () => result(teamCampaign),
      ['GET /campaigns/' + id + '/team']: () => result([member]),
      'GET /users': ({ params }) => result(params.role === 'animateur' ? [mine] : [supervisor]),
      ['POST /campaigns/' + id + '/team']: () => [201, { data: { id: 'tm-2' } }],
      ['POST /campaigns/' + id + '/team/new']: () => [
        201,
        {
          data: { member: { id: 'tm-3' }, user: { id: 'a-9' }, temporaryPassword: 'Tmp-pass-123' },
        },
      ],
    });
    const user = userEvent.setup();
    renderApp('/app/campaigns/' + id + '?tab=team&sub=team');
    expect(await screen.findByText('Lina Already')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 Animateurs chosen')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add to the campaign' }));
    let dialog = screen.getByRole('dialog');
    await within(dialog).findByRole('option', { name: mine.fullName });
    await user.selectOptions(within(dialog).getByLabelText('Choose an Animateur'), mine.id);
    await user.click(within(dialog).getByRole('button', { name: 'Add to the campaign' }));
    await waitFor(() =>
      expect(calls.calls.find(({ key }) => key === 'POST /campaigns/' + id + '/team').body).toEqual(
        {
          animateurId: mine.id,
        },
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Add to the campaign' }));
    dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Create a new Animateur' }));
    await user.type(within(dialog).getByLabelText('Full name'), 'Nadia New');
    await user.type(within(dialog).getByLabelText('Email'), 'nadia@agency.dz');
    // The mode switch and the submit button share a name: the submit button comes last.
    await user.click(
      within(dialog).getAllByRole('button', { name: 'Create a new Animateur' }).at(-1),
    );
    await waitFor(() =>
      expect(
        calls.calls.find(({ key }) => key === 'POST /campaigns/' + id + '/team/new').body,
      ).toEqual({ fullName: 'Nadia New', email: 'nadia@agency.dz', wilayaId: 16 }),
    );
    expect(await screen.findByDisplayValue('Tmp-pass-123')).toBeInTheDocument();
  });

  it('shows a supervisor full when his team reaches the number the director asked', async () => {
    const me = makeUser({ role: 'supervisor' });
    const fullCampaign = {
      ...campaign,
      status: 'planning',
      wilayas: [
        {
          wilayaId: 16,
          requiredAnimateurs: 1,
          wilaya: { nameEn: 'Algiers', nameAr: 'الجزائر' },
          staff: [
            {
              id: 'st-9',
              role: 'supervisor',
              wilayaId: 16,
              requiredAnimateurs: 1,
              teamCount: 1,
              user: { id: me.id, fullName: me.fullName, role: 'supervisor' },
            },
          ],
        },
      ],
    };
    stub('supervisor', {
      ['GET /campaigns/' + id]: () => result(fullCampaign),
      ['GET /campaigns/' + id + '/team']: () =>
        result([
          {
            id: 'tm-1',
            supervisorId: me.id,
            animateur: { id: 'a-0', fullName: 'Lina Already', status: 'active' },
          },
        ]),
    });
    renderApp('/app/campaigns/' + id + '?tab=team&sub=team');
    expect(
      await screen.findByText('You have chosen all the Animateurs asked of you.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to the campaign' })).toBeNull();
  });

  it('rejects a too-large document before sending it', async () => {
    const calls = stub('director');
    const user = userEvent.setup();
    renderApp('/app/campaigns/' + id + '?tab=documents');
    const input = await screen.findByLabelText('Choose a file', { selector: 'input' });
    const big = new File(['%PDF-1.4'], 'mecanisme.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 21 * 1024 * 1024 });
    await user.upload(input, big);
    expect(await screen.findByRole('alert')).toHaveTextContent('The file is too large.');
    await user.type(screen.getByLabelText('Label'), 'Mécanisme');
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
    expect(calls.count('POST /campaigns/' + id + '/documents')).toBe(0);
  });

  it('hides every edit control in read-only mode', async () => {
    stub('supervisor');
    const user = userEvent.setup();
    renderApp('/app/campaigns/' + id);
    await screen.findByRole('tab', { name: 'Team' });
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'New campaign' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Team' }));
    await screen.findByText(/Rachid Regional/);
    expect(screen.queryByRole('button', { name: /Add|Remove/ })).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Setup' }));
    await user.click(screen.getByRole('button', { name: 'Documents' }));
    await screen.findByText('No results.');
    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
  });

  it('renders the Arabic detail page right to left', async () => {
    await i18n.changeLanguage('ar');
    stub('regional_manager');
    renderApp('/app/campaigns/' + id);
    const main = await screen.findByRole('main');
    await within(main).findByRole('heading', { name: campaign.name });
    expect({
      direction: document.documentElement.dir,
      tabs: screen.getAllByRole('tab').map((tab) => tab.textContent),
      selected: screen.getByRole('tab', { selected: true }).textContent,
    }).toMatchInlineSnapshot(`
      {
        "direction": "rtl",
        "selected": "نظرة عامة",
        "tabs": [
          "نظرة عامة",
          "الميدان",
          "المبيعات والهدايا",
          "المخزون",
          "الفريق",
          "الإعداد",
          "النشاط",
        ],
      }
    `);
  });
});
