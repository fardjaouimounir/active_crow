import { ROLE_PERMISSIONS } from '@fieldflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resetSessionForTests } from '../src/shared/auth/session.js';
import i18n from '../src/shared/i18n/index.js';
import { makeUser, mockApi, sessionFor } from './helpers/mockApi.js';
import { renderApp } from './helpers/renderApp.jsx';

const id = '99111111-1111-4111-8111-111111111111';
const assignmentId = '44111111-1111-4111-8111-111111111111';
const point = {
  id: '55111111-1111-4111-8111-111111111111',
  name: 'Test store',
  wilaya: { nameEn: 'Algiers', nameAr: 'الجزائر' },
};
const animateur = { id: '88111111-1111-4111-8111-111111111111', fullName: 'Amel' };
const proof = {
  id: '65111111-1111-4111-8111-111111111111',
  status: 'pending',
  recordedAt: '2026-11-20T07:46:00Z',
  flags: ['late'],
};
const date = '2026-11-20';
const campaign = {
  id,
  code: 'CMP-2026-001',
  name: 'Demo Campaign',
  status: 'active',
  startDate: date,
  endDate: date,
  client: { name: 'Demo' },
  wilayas: [],
  pointsOfSale: [],
  products: [],
};
const board = {
  date,
  campaignId: id,
  counters: {
    pending: 1,
    verified: 0,
    rejected: 0,
    not_sent: 1,
    absent_justified: 0,
    absent_unjustified: 0,
    late: 1,
  },
  rows: [
    {
      assignmentId,
      pointOfSale: point,
      animateur,
      supervisor: { fullName: 'Samia' },
      absenceHistory: [],
      checkpoints: [
        {
          code: 'morning',
          label: { en: 'Morning', ar: 'صباح' },
          window: ['08:30', '09:30'],
          status: 'pending',
          flags: ['late'],
          record: proof,
        },
        {
          code: 'after_break',
          label: { en: 'After break', ar: 'بعد الراحة' },
          window: ['13:30', '14:30'],
          status: 'not_sent',
          flags: [],
          record: null,
        },
      ],
    },
  ],
};
const reply = (data) => () => [200, { data }];
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

function open(tab) {
  const user = makeUser({ role: 'supervisor', permissions: ROLE_PERMISSIONS.supervisor });
  api = mockApi({
    'POST /auth/refresh': () => [200, sessionFor(user)],
    'GET /auth/me': reply({ user, permissions: ROLE_PERMISSIONS.supervisor }),
    [`GET /campaigns/${id}`]: reply(campaign),
    [`GET /campaigns/${id}/attendance/board`]: reply(board),
    [`GET /attendance/${proof.id}`]: reply(proof),
    [`POST /attendance/${proof.id}/verify`]: reply({ ...proof, status: 'verified' }),
    [`POST /attendance/${proof.id}/reject`]: reply({ ...proof, status: 'rejected' }),
    [`POST /assignments/${assignmentId}/absences`]: reply({ id: 'absence' }),
    [`GET /campaigns/${id}/visits`]: reply([]),
    [`GET /campaigns/${id}/visits/options`]: reply([{ ...point, animateurs: [animateur] }]),
  });
  renderApp(`/app/campaigns/${id}?tab=${tab}&date=${date}`);
  return userEvent.setup();
}

describe('campaign attendance', () => {
  it(
    'shows the legend, verifies and rejects a pending proof, and records an absence',
    { timeout: 20_000 },
    async () => {
      const user = open('attendance');
      expect(await screen.findByLabelText('Status legend')).toHaveTextContent('Not sent');
      await user.click(screen.getByRole('button', { name: /^Pending/ }));
      await user.click(await screen.findByRole('button', { name: 'Verify', exact: true }));
      await waitFor(() => expect(api.count(`POST /attendance/${proof.id}/verify`)).toBe(1));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: /^Pending/ }));
      await user.click(await screen.findByRole('button', { name: 'Reject', exact: true }));
      await user.type(screen.getByLabelText('Reason'), 'Wrong photo');
      await user.click(screen.getByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(api.count(`POST /attendance/${proof.id}/reject`)).toBe(1));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: 'Record absence' }));
      await user.type(screen.getByLabelText('Reason'), 'Medical appointment');
      await user.click(screen.getByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(api.count(`POST /assignments/${assignmentId}/absences`)).toBe(1));
      expect(api.calls.find(({ key }) => key.endsWith('/absences')).idempotencyKey).toBeTruthy();
    },
  );

  it('renders Arabic with a logical sticky start column', { timeout: 20_000 }, async () => {
    await i18n.changeLanguage('ar');
    open('attendance');
    const table = await screen.findByRole('table');
    expect(document.documentElement.dir).toBe('rtl');
    expect(within(table).getByRole('rowheader')).toHaveClass('sticky', 'start-0');
    expect([...within(table).getAllByRole('columnheader')].map((element) => element.textContent))
      .toMatchInlineSnapshot(`
        [
          "منشط",
          "صباح",
          "بعد الراحة",
          "سجل الغياب",
        ]
      `);
  });

  it(
    'offers only API-provided points of sale and their observed Animateurs',
    { timeout: 20_000 },
    async () => {
      const user = open('visits');
      await user.click(await screen.findByRole('button', { name: 'New visit' }));
      const picker = await within(screen.getByRole('dialog')).findByLabelText('Point de Vente');
      await user.selectOptions(picker, point.id);
      expect(screen.getByRole('checkbox', { name: animateur.fullName })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Add issue' }));
      expect(screen.getByLabelText('Category')).toBeInTheDocument();
    },
  );
});
