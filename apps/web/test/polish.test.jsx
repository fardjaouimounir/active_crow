import { ROLE_PERMISSIONS } from '@fieldflow/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataTable } from '../src/shared/ui/DataTable.jsx';
import { ListToolbar, useColumnVisibility } from '../src/shared/ui/ListToolbar.jsx';
import { resetSessionForTests } from '../src/shared/auth/session.js';
import { resources } from '../src/shared/i18n/index.js';
import { KpiTile } from '../src/ui/data.jsx';
import {
  THIN,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatRelative,
} from '../src/ui/format.js';
import { ProgressBar, Sparkline, StackedBar } from '../src/ui/viz.jsx';
import { makeUser, mockApi, sessionFor } from './helpers/mockApi.js';
import { renderApp } from './helpers/renderApp.jsx';

describe('number formatting (17C §3)', () => {
  it('groups thousands with a thin space and prints currency after the figure', () => {
    expect(formatNumber(1500000)).toBe(`1${THIN}500${THIN}000`);
    expect(formatCurrency('1500000.00', 'en')).toBe('1 500 000 DA');
    // Right-to-left: a no-break space, so the digit groups stay one number in Arabic text.
    expect(formatCurrency('1500000.00', 'ar')).toBe('1 500 000 دج');
    expect(formatNumber(2676, { rtl: true })).toBe('2 676');
  });

  it('prints one decimal for percentages and a dash instead of a made-up zero', () => {
    expect(formatPercent(0.4796)).toBe('48.0%');
    expect(formatPercent(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
    expect(formatNumber(0)).toBe('0');
  });

  it('says how long ago something happened, never in the future', () => {
    const now = Date.parse('2026-11-21T12:00:00Z');
    expect(formatRelative('2026-11-21T11:48:00Z', 'en', now)).toMatch(/12/);
    expect(formatRelative('2026-11-19T12:00:00Z', 'en', now)).toMatch(/2/);
  });
});

describe('visual primitives', () => {
  it('Sparkline draws a line for a series and nothing for too little data', () => {
    const { container, rerender } = render(<Sparkline values={[1, 3, 2, 5]} label="14 days" />);
    expect(screen.getByRole('img', { name: '14 days' })).toBeInTheDocument();
    expect(container.querySelectorAll('polyline').length).toBe(1);
    rerender(<Sparkline values={[4]} />);
    expect(container.querySelector('polyline')).toBeNull();
  });

  it('ProgressBar exposes its value to assistive technology and clamps it', () => {
    render(<ProgressBar value={150} max={100} label="Target" />);
    const bar = screen.getByRole('progressbar', { name: 'Target' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
  });

  it('StackedBar lists every segment as text, never colour alone', () => {
    render(
      <StackedBar
        segments={[
          { key: 'a', label: 'Verified', value: 3, tone: 'accent' },
          { key: 'b', label: 'Pending', value: 1, tone: 'info' },
        ]}
      />,
    );
    expect(screen.getByRole('img')).toHaveAccessibleName('Verified: 3, Pending: 1');
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });

  it('KpiTile shows a target bar and a sparkline slot, and a dash when there is no value', () => {
    render(
      <dl>
        <KpiTile
          label="Target"
          value={0.455}
          format={formatPercent}
          animate={false}
          hero
          progress={{ value: 0.455, max: 1, label: 'Progress', caption: 'Target 100' }}
          sparkline={<Sparkline values={[1, 2, 3]} label="trend" />}
        />
        <KpiTile label="Empty" value={null} animate={false} />
      </dl>,
    );
    expect(screen.getByText('45.5%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Progress' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'trend' })).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

function Harness({ onBulk }) {
  const columns = useColumnVisibility('test-table');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(new Set());
  const rows = [
    { id: '1', name: 'Alpha', code: 'A-1' },
    { id: '2', name: 'Beta', code: 'B-2' },
  ];
  return (
    <>
      <ListToolbar
        search={{ label: 'Search', value: '', onChange: () => {} }}
        filters={[
          {
            name: 'status',
            label: 'Status',
            value: status,
            options: [
              { value: 'active', label: 'Active' },
              { value: 'draft', label: 'Draft' },
            ],
            onChange: setStatus,
          },
        ]}
        columns={{
          all: [
            { id: 'name', label: 'Name' },
            { id: 'code', label: 'Code' },
          ],
          ...columns,
        }}
      />
      <DataTable
        columns={[
          { accessorKey: 'name', header: 'Name' },
          { accessorKey: 'code', header: 'Code' },
        ]}
        rows={rows}
        total={2}
        hidden={columns.hidden}
        rowActions={(row) => <button>Open {row.name}</button>}
        selectable
        selected={selected}
        onSelect={setSelected}
        bulkBar={({ count, clear }) => (
          <>
            <span>{count} selected</span>
            <button onClick={() => onBulk?.([...selected])}>Approve</button>
            <button onClick={clear}>Clear selection</button>
          </>
        )}
      />
    </>
  );
}

describe('list toolbar and table', () => {
  beforeEach(() => localStorage.clear());

  it('a chosen filter becomes an active chip that can be cleared', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const select = screen.getByRole('combobox', { name: 'Status' });
    await user.selectOptions(select, 'active');
    expect(select).toHaveValue('active');
    await user.click(screen.getByRole('button', { name: 'Clear Status' }));
    expect(select).toHaveValue('');
  });

  it('hides a column from the column menu and remembers it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole('columnheader', { name: 'Code' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(screen.getByRole('checkbox', { name: 'Code' }));
    expect(screen.queryByRole('columnheader', { name: 'Code' })).toBeNull();
    expect(JSON.parse(localStorage.getItem('acticrew.columns.test-table'))).toEqual(['code']);
  });

  it('shows row actions and a bulk bar once rows are selected', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole('region', { name: /selection/i })).toBeNull();
    const first = screen.getAllByRole('checkbox', { name: 'Select row' })[0];
    await user.click(first);
    const bar = screen.getByRole('region', { name: /selection/i });
    expect(within(bar).getByText('1 selected')).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('region', { name: /selection/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Alpha' })).toBeInTheDocument();
  });
});

describe('translations of the polish pass', () => {
  it('English and Arabic define the same keys', () => {
    const keys = (value, prefix = '') =>
      Object.entries(value).flatMap(([key, child]) =>
        child && typeof child === 'object' ? keys(child, `${prefix}${key}.`) : [`${prefix}${key}`],
      );
    expect(keys(resources.ar.pro).sort()).toEqual(keys(resources.en.pro).sort());
  });
});

// ─── The review queue: A accepts, R rejects with a reason, the card leaves the queue ─────────────

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
}

const ok = (data, meta) => [200, { data, ...(meta ? { meta } : {}) }];
const campaignId = '99111111-1111-4111-8111-111111111111';
const pendingRow = (id, name, extra = {}) => ({
  id,
  campaignId,
  animateurId: 'a-' + id,
  pointOfSaleId: 'store-1',
  recordedAt: '2026-11-20T07:42:00.000Z',
  checkpoint: 'morning',
  isLate: false,
  distanceM: 30,
  flags: [],
  photoFileId: null,
  status: 'pending',
  animateur: { id: 'a-' + id, fullName: name },
  ...extra,
});

describe('attendance review queue', () => {
  let api;
  let verified;
  let failVerify;
  beforeEach(() => {
    localStorage.clear();
    verified = [];
    failVerify = false;
    const user = makeUser({ role: 'director' });
    api = mockApi({
      'POST /auth/refresh': () => [200, sessionFor(user)],
      'GET /auth/me': () => ok({ user, permissions: ROLE_PERMISSIONS.director }),
      'GET /notifications/unread-count': () => ok({ count: 0 }),
      'GET /assignments/pending': () => ok([], { page: 1, pageSize: 1, total: 0 }),
      'GET /issues': () => ok([], { page: 1, pageSize: 1, total: 0 }),
      'GET /me/attendance/review': () =>
        ok({
          date: '2026-11-21',
          campaigns: [
            {
              campaignId,
              campaignName: 'Winter tasting',
              counters: {
                verified: 4,
                pending: 2,
                rejected: 0,
                not_sent: 1,
                late: 1,
                absent_justified: 0,
                absent_unjustified: 0,
              },
              pending: [],
            },
          ],
        }),
      'GET /campaigns': () =>
        ok([{ id: campaignId, name: 'Winter tasting' }], { page: 1, pageSize: 20, total: 1 }),
      [`GET /campaigns/${campaignId}`]: () =>
        ok({
          id: campaignId,
          name: 'Winter tasting',
          pointsOfSale: [{ id: 'store-1', name: 'Hypermarché Tassili' }],
        }),
      [`GET /campaigns/${campaignId}/assignments`]: () =>
        ok([{ animateurId: 'a-p1', supervisor: { id: 's-1', fullName: 'Samir Ouali' } }]),
      [`GET /campaigns/${campaignId}/attendance`]: () =>
        ok(
          [
            pendingRow('p1', 'Yacine Haddad', { isLate: true }),
            pendingRow('p2', 'Meriem Hamdi', { flags: ['far_from_pos'], distanceM: 1018 }),
          ].filter((row) => !verified.includes(row.id)),
          { page: 1, pageSize: 100, total: 2 },
        ),
      'POST /attendance/p2/verify': () => {
        if (failVerify) return [500, { error: { code: 'INTERNAL_ERROR', message: 'x' } }];
        verified.push('p2');
        return ok({ id: 'p2', status: 'verified' });
      },
    });
  });
  afterEach(() => {
    api.restore();
    resetSessionForTests();
    localStorage.clear();
  });

  it('puts the far-from-store check-in first and accepts it with the A key', async () => {
    const user = userEvent.setup();
    renderApp('/app/attendance');
    const cards = await screen.findAllByRole('article');
    // Problems first: the check-in 1018 m away leads the late one.
    expect(cards[0]).toHaveAccessibleName(/Meriem Hamdi/);
    expect(within(cards[0]).getByText(/1018 m/)).toBeInTheDocument();
    expect(screen.getByText('2 to review')).toBeInTheDocument();

    await user.keyboard('a');
    await waitFor(() => expect(api.count('POST /attendance/p2/verify')).toBe(1));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
    expect(screen.getByRole('article')).toHaveAccessibleName(/Yacine Haddad/);
  });

  it('brings the card back with a message when the server refuses the accept', async () => {
    failVerify = true;
    const user = userEvent.setup();
    renderApp('/app/attendance');
    await screen.findAllByRole('article');
    await user.keyboard('a');
    expect(await screen.findByText(/did not go through/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
  });

  it('ignores a held key: one press accepts one check-in', async () => {
    renderApp('/app/attendance');
    await screen.findAllByRole('article');
    const press = (repeat) =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', repeat, bubbles: true }));
    press(false);
    press(true);
    press(true);
    await waitFor(() => expect(api.count('POST /attendance/p2/verify')).toBe(1));
  });

  it('keeps keystrokes inside the reason field from accepting a card', async () => {
    const user = userEvent.setup();
    renderApp('/app/attendance');
    await screen.findAllByRole('article');
    await user.click(screen.getAllByRole('button', { name: /Reject/ })[0]);
    const reason = await screen.findByRole('textbox', { name: 'Write another reason…' });
    await user.type(reason, 'a bad photo');
    expect(api.count('POST /attendance/p2/verify')).toBe(0);
    expect(reason).toHaveValue('a bad photo');
  });
});
