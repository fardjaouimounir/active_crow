import { ROLE_PERMISSIONS, calculateKpis, runDraw } from '@fieldflow/shared';
import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, it } from 'vitest';
import i18n from '../src/shared/i18n/index.js';
import { resetSessionForTests } from '../src/shared/auth/session.js';
import { makeUser, mockApi, sessionFor } from './helpers/mockApi.js';
import { renderApp } from './helpers/renderApp.jsx';

const campaignId = '33333333-3333-4333-8333-333333333333';
const tombolaId = '66666666-6666-4666-8666-666666666666';
const photoIds = ['77777777-7777-4777-8777-777777777771', '77777777-7777-4777-8777-777777777772'];
const period = { from: '2026-11-01', to: '2026-11-30' };
let api;
const ok = (data) => [200, { data }];
const kpis = calculateKpis(period, {
  salesUnits: 42,
  identifiedBuyers: 30,
  anonymousSales: 4,
  entitledUnits: 20,
  distributedUnits: 18,
  verified: 9,
  expectedSlots: 10,
  elapsedDays: 5,
  plannedDays: 30,
});
const stock = { stockIn: 100, customers: 18, losses: 1, returnedToClient: 5, physical: 76 };
const campaign = {
  id: campaignId,
  code: 'CMP-2026-001',
  name: 'Ramadan 2026',
  status: 'active',
  startDate: '2026-11-01T00:00:00.000Z',
  endDate: '2026-11-30T00:00:00.000Z',
  provisional: true,
  client: { id: 'c1', name: 'Client X' },
  wilayas: [{ id: 16, nameEn: 'Algiers', nameAr: 'الجزائر' }],
  period,
  kpis: { ...kpis, stock },
  tombolas: [
    { id: tombolaId, name: 'Grand draw', status: 'closed', winnersCount: 2, reservesCount: 1 },
  ],
  commentary: null,
  headline: {
    units: 42,
    buyers: 34,
    distributedUnits: 18,
    completionRate: 0.16,
    targetAchievement: null,
  },
};
const tombola = {
  id: tombolaId,
  campaign: { id: campaignId, name: 'Ramadan 2026', code: 'CMP-2026-001' },
  name: 'Grand draw',
  status: 'closed',
  entryBasis: 'per_sale',
  entriesPerBasis: 1,
  maxEntriesPerCustomer: null,
  requiresPurchase: true,
  registrationEndsAt: '2026-11-25T20:00:00.000Z',
  drawScheduledAt: '2026-11-26T20:00:00.000Z',
  winnersCount: 2,
  reservesCount: 1,
  entryCount: 30,
  commitment: {
    entriesHash: 'ab'.repeat(32),
    eligibleCount: 30,
    committedAt: '2026-11-25T20:00:01.000Z',
  },
  draw: null,
};

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
}

beforeAll(() => {
  Object.assign(URL, { createObjectURL: () => 'blob:photo', revokeObjectURL: () => {} });
});

function setup(role, extra = {}) {
  const user = makeUser({ role, clientId: role === 'client' ? 'c1' : null });
  api = mockApi({
    'POST /auth/refresh': () => [200, sessionFor(user)],
    'GET /auth/me': () => ok({ user, permissions: ROLE_PERMISSIONS[role] }),
    'GET /notifications/unread-count': () => ok({ count: 0 }),
    'GET /portal/campaigns': () => ok([campaign]),
    [`GET /portal/campaigns/${campaignId}`]: () => ok(campaign),
    [`GET /portal/campaigns/${campaignId}/breakdown`]: () => ok([]),
    [`GET /portal/campaigns/${campaignId}/proof`]: () =>
      ok(
        photoIds.map((fileId, index) => ({
          fileId,
          date: `2026-11-0${index + 1}`,
          store: `Store ${index + 1}`,
          wilaya: campaign.wilayas[0],
        })),
      ),
    [`GET /portal/campaigns/${campaignId}/documents`]: () => ok([]),
    [`GET /files/${photoIds[0]}/thumbnail`]: () => [200, new Blob(['x'], { type: 'image/webp' })],
    [`GET /files/${photoIds[1]}/thumbnail`]: () => [200, new Blob(['x'], { type: 'image/webp' })],
    [`GET /files/${photoIds[0]}`]: () => [200, new Blob(['x'], { type: 'image/webp' })],
    [`GET /files/${photoIds[1]}`]: () => [200, new Blob(['x'], { type: 'image/webp' })],
    [`GET /tombolas/${tombolaId}`]: () => ok(tombola),
    [`GET /tombolas/${tombolaId}/winners`]: () => ok([]),
    ...extra,
  });
  return user;
}

afterEach(async () => {
  api?.restore();
  resetSessionForTests();
  await i18n.changeLanguage('en');
});

it('sends each role to its own surface: the client stays in /portal, the director in /app', async () => {
  setup('client');
  const view = renderApp('/app/dashboard');
  expect(await screen.findByRole('heading', { name: 'Your campaigns' })).toBeInTheDocument();
  expect(view.location()).toBe('/portal');
  api.restore();
  resetSessionForTests();
  view.unmount();

  setup('director');
  const staff = renderApp('/portal');
  await waitFor(() => expect(staff.location()).toBe('/app'));
});

it('lists the campaigns of the client with their headline results', async () => {
  setup('client');
  renderApp('/portal');
  const card = (await screen.findByRole('heading', { name: 'Ramadan 2026' })).closest('li');
  expect(within(card).getByText('Units sold')).toBeInTheDocument();
  expect(within(card).getByText('Provisional: figures can still change.')).toBeInTheDocument();
  expect(within(card).getByRole('link', { name: 'Open' })).toHaveAttribute(
    'href',
    `/portal/campaigns/${campaignId}`,
  );
});

it('shows results only: no attendance card, a proof gallery with a keyboard lightbox', async () => {
  setup('client');
  renderApp(`/portal/campaigns/${campaignId}`);
  expect(await screen.findByRole('heading', { name: 'Ramadan 2026' })).toBeInTheDocument();
  expect(screen.getByText('Sales volume')).toBeInTheDocument();
  expect(screen.queryByText('Attendance rate')).not.toBeInTheDocument();
  expect(screen.queryByText('Visits')).not.toBeInTheDocument();
  const user = userEvent.setup();
  const first = await screen.findByRole('button', { name: /Photo 1: Store 1/ });
  await user.click(first);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('1 / 2')).toBeInTheDocument();
  await user.keyboard('{ArrowRight}');
  expect(within(dialog).getByText('2 / 2')).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('lets the director preview exactly what the client sees, read only', async () => {
  setup('director');
  renderApp(`/app/campaigns/${campaignId}/client-preview`);
  expect(await screen.findByRole('heading', { name: 'Ramadan 2026' })).toBeInTheDocument();
  expect(screen.getByRole('note')).toHaveTextContent('This is exactly what the client sees');
  expect(screen.getByText('Sales volume')).toBeInTheDocument();
  expect(screen.queryByText('Attendance rate')).not.toBeInTheDocument();
});

it('renders the portal campaign in Arabic and RTL', async () => {
  await i18n.changeLanguage('ar');
  setup('client');
  renderApp(`/portal/campaigns/${campaignId}`);
  const title = await screen.findByRole('heading', { name: 'Ramadan 2026' });
  expect(document.documentElement.dir).toBe('rtl');
  expect(title.outerHTML).toMatchInlineSnapshot(
    `"<h1 class="text-3xl font-semibold" dir="auto">Ramadan 2026</h1>"`,
  );
  expect(screen.getByText('صور الزيارات')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'تنزيل Excel' })).toBeInTheDocument();
});

it('draw: shows the commitment, needs every prize label, confirms, then posts once', async () => {
  const drawn = {
    ...tombola,
    status: 'drawn',
    draw: {
      drawnAt: '2026-11-26T20:00:00.000Z',
      drawnBy: { kind: 'client', name: 'Amina Benali' },
      algorithm: 'hmac-sha256-fisher-yates-v1',
      eligibleCount: 30,
      entriesHash: tombola.commitment.entriesHash,
    },
  };
  let done = false;
  setup('client', {
    [`GET /tombolas/${tombolaId}`]: () => ok(done ? drawn : tombola),
    [`POST /tombolas/${tombolaId}/draw`]: () => {
      done = true;
      return [201, { data: drawn }];
    },
  });
  const user = userEvent.setup();
  renderApp(`/portal/tombolas/${tombolaId}`);
  expect(await screen.findByText('ab'.repeat(32))).toBeInTheDocument();
  expect(screen.getByText('Commitment published before the draw')).toBeInTheDocument();
  const draw = screen.getByRole('button', { name: 'Draw' });
  expect(draw).toBeDisabled();
  await user.type(screen.getByLabelText(/Your own random phrase/), 'my phrase');
  await user.type(screen.getByLabelText('Prize for winner 1'), 'TV');
  expect(draw).toBeDisabled();
  await user.type(screen.getByLabelText('Prize for winner 2'), 'Phone');
  await user.click(draw);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/final and cannot be repeated or undone/)).toBeInTheDocument();
  expect(api.count(`POST /tombolas/${tombolaId}/draw`)).toBe(0);
  await user.click(within(dialog).getByRole('button', { name: 'Yes, draw now' }));
  await waitFor(() => expect(api.count(`POST /tombolas/${tombolaId}/draw`)).toBe(1));
  expect(api.calls.find(({ key }) => key.endsWith('/draw')).body).toEqual({
    clientNonce: 'my phrase',
    prizes: [
      { rank: 1, label: 'TV' },
      { rank: 2, label: 'Phone' },
    ],
  });
  expect(await screen.findByText(/Amina Benali \(client\)/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Draw' })).not.toBeInTheDocument();
});

async function verificationData() {
  const entryNumbers = Array.from({ length: 30 }, (_, index) => index + 1);
  const input = {
    entryNumbers,
    serverRandom: '11'.repeat(32),
    clientNonce: 'nonce',
    winnersCount: 2,
    reservesCount: 1,
  };
  const result = await runDraw(input);
  return { ...input, ...result };
}

it('verifies a real draw in the browser (✓) and flags tampered data (✗)', async () => {
  const published = await verificationData();
  const drawn = {
    ...tombola,
    status: 'drawn',
    // The commitment published before the draw.
    commitment: { ...tombola.commitment, entriesHash: published.entriesHash },
    draw: { drawnAt: '2026-11-26T20:00:00.000Z', drawnBy: { kind: 'agency', name: null } },
  };
  for (const [data, mark, text] of [
    [published, '✓', /recomputing it gives exactly the same winners/],
    [
      { ...published, winners: [...published.winners].reverse() },
      '✗',
      /does not match the published one/,
    ],
    // A list that is self-consistent but not the committed one is refused too.
    [{ ...published, entriesHash: 'cd'.repeat(32) }, '✗', /does not match the published one/],
  ]) {
    setup('client', {
      [`GET /tombolas/${tombolaId}`]: () => ok(drawn),
      [`GET /tombolas/${tombolaId}/draw/verification`]: () => ok(data),
    });
    const user = userEvent.setup();
    const view = renderApp(`/portal/tombolas/${tombolaId}`);
    await user.click(await screen.findByRole('button', { name: 'Verify in browser' }));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(mark);
    expect(status).toHaveTextContent(text);
    view.unmount();
    api.restore();
    resetSessionForTests();
  }
});

it('the agency page shows the follow-up with delivery actions and audited contacts', async () => {
  const drawn = {
    ...tombola,
    status: 'drawn',
    draw: { drawnAt: '2026-11-26T20:00:00.000Z', drawnBy: { kind: 'agency', name: null } },
  };
  const winner = {
    id: 'w1',
    rank: 1,
    isReserve: false,
    entryNumber: 7,
    customer: { fullName: 'K. H.', phone: '+213 5•• •• •• 56' },
    prizeLabel: 'TV',
    servesRank: null,
    deliveryStatus: 'pending',
    deliveredAt: null,
    unreachableReason: null,
  };
  setup('director', {
    [`GET /tombolas/${tombolaId}`]: () => ok(drawn),
    [`GET /tombolas/${tombolaId}/winners`]: ({ params }) =>
      ok([
        params?.personal
          ? { ...winner, customer: { fullName: 'Karim Haddad', phone: '+213550123456' } }
          : winner,
      ]),
    [`POST /tombolas/${tombolaId}/winners/w1/delivered`]: () => ok({ id: 'w1' }),
  });
  const user = userEvent.setup();
  renderApp(`/app/tombolas/${tombolaId}`);
  expect(await screen.findByText('+213 5•• •• •• 56')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Show contacts (audited)' }));
  expect(await screen.findByText('Karim Haddad')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Mark delivered' }));
  await waitFor(() =>
    expect(api.count(`POST /tombolas/${tombolaId}/winners/w1/delivered`)).toBe(1),
  );
});
