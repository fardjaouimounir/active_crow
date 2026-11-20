import { ROLE_PERMISSIONS, calculateKpis } from '@fieldflow/shared';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import i18n from '../src/shared/i18n/index.js';
import { resetSessionForTests } from '../src/shared/auth/session.js';
import { makeUser, mockApi, sessionFor } from './helpers/mockApi.js';
import { renderApp } from './helpers/renderApp.jsx';

const campaignId = '33333333-3333-4333-8333-333333333333';
const animateurId = '44444444-4444-4444-8444-444444444444';
const suggestionId = '55555555-5555-4555-8555-555555555555';
const period = { from: '2026-11-16', to: '2026-11-20' };
let api;
const ok = (data, meta) => [200, meta ? { data, meta } : { data }];

const kpis = (salesTarget) =>
  calculateKpis(period, { salesUnits: 18, expectedSlots: 4, verified: 2, salesTarget });

const insights = {
  id: suggestionId,
  requestId: 'r',
  capability: 'campaign_insights',
  subjectType: 'campaign',
  subjectId: campaignId,
  subjectName: 'Ramadan 2026',
  status: 'pending_review',
  modelVersion: 'Qwen/Qwen3.8-27B@prompt-v1',
  fallback: false,
  confidence: 0.82,
  failure: null,
  createdAt: '2026-11-20T10:00:00.000Z',
  reviewedAt: null,
  reviewedBy: null,
  output: {
    narrative: 'The campaign is on track.',
    risks: [
      { severity: 'low', text: 'Low risk', evidence: [] },
      { severity: 'high', text: 'Gift stock is low', evidence: [] },
    ],
    opportunities: [],
    decisions: [],
  },
  labels: {},
  kpis: kpis(100),
  request: { status: 'completed', requestedById: null },
};

function setup(role, extra = {}, { enabled = true } = {}) {
  const user = makeUser({ role });
  api = mockApi({
    'POST /auth/refresh': () => [200, sessionFor(user)],
    'GET /auth/me': () => ok({ user, permissions: ROLE_PERMISSIONS[role] }),
    'GET /notifications/unread-count': () => ok({ count: 0 }),
    'GET /reports/kpis': () => ok({ ...kpis(undefined), alerts: {}, options: {} }),
    'GET /reports/breakdown': () => ok([]),
    'GET /ai/requests': () => ok([], { page: 1, pageSize: 1, total: 0, enabled }),
    'GET /ai/commentary': () => ok(null),
    ...extra,
  });
  return user;
}

afterEach(async () => {
  api?.restore();
  resetSessionForTests();
  await i18n.changeLanguage('en');
});

it('lists suggestions and shows the output beside our own KPIs with names resolved', async () => {
  setup('director', {
    'GET /ai/suggestions': () => ok([insights], { page: 1, pageSize: 25, total: 1 }),
    [`GET /ai/suggestions/${suggestionId}`]: () =>
      ok({
        ...insights,
        capability: 'animateur_coaching',
        output: {
          coaching: [
            { label: 'A1', strengths: ['Great energy'], gaps: [], actions: ['Keep going'] },
          ],
          campaignActions: [],
        },
        labels: { A1: { type: 'user', id: animateurId, name: 'Karim Haddad' } },
      }),
  });
  const user = userEvent.setup();
  renderApp('/app/ai-review');
  expect(await screen.findByRole('heading', { name: 'AI review' })).toBeInTheDocument();
  expect(await screen.findByText('Ramadan 2026')).toBeInTheDocument();
  await user.click(screen.getByRole('link', { name: 'Open' }));
  expect(await screen.findByRole('heading', { name: 'Karim Haddad' })).toBeInTheDocument();
  expect(screen.queryByText('A1')).not.toBeInTheDocument();
  expect(screen.getByText('Our figures for the same filters')).toBeInTheDocument();
  expect(screen.getByText('Qwen/Qwen3.8-27B@prompt-v1')).toBeInTheDocument();
});

it('reject needs a note, accept sends it, risks are ordered by severity', async () => {
  setup('director', {
    [`GET /ai/suggestions/${suggestionId}`]: () => ok(insights),
    [`POST /ai/suggestions/${suggestionId}/accept`]: () =>
      ok({ id: suggestionId, status: 'accepted' }),
    [`POST /ai/suggestions/${suggestionId}/reject`]: () =>
      ok({ id: suggestionId, status: 'rejected' }),
  });
  const user = userEvent.setup();
  renderApp(`/app/ai-review/${suggestionId}`);
  await screen.findByText('The campaign is on track.');
  const risks = screen.getAllByText(/risk|stock is low/i).map((node) => node.textContent);
  expect(risks.indexOf('Gift stock is low')).toBeLessThan(risks.indexOf('Low risk'));
  await user.click(screen.getByRole('button', { name: 'Reject' }));
  expect(await screen.findByText('A note is required to reject.')).toBeInTheDocument();
  expect(api.count(`POST /ai/suggestions/${suggestionId}/reject`)).toBe(0);
  await user.type(screen.getByLabelText('Note'), 'Looks off');
  await user.click(screen.getByRole('button', { name: 'Accept' }));
  await waitFor(() => expect(api.count(`POST /ai/suggestions/${suggestionId}/accept`)).toBe(1));
  expect(api.calls.find(({ key }) => key.endsWith('/accept')).body).toEqual({ note: 'Looks off' });
});

it('shows a failure output with its translated error code', async () => {
  setup('director', {
    [`GET /ai/suggestions/${suggestionId}`]: () =>
      ok({
        ...insights,
        failure: 'NEEDS_DATA',
        output: { error: { code: 'NEEDS_DATA', message: 'x' } },
      }),
  });
  renderApp(`/app/ai-review/${suggestionId}`);
  expect(
    await screen.findByText('There was not enough data to write this suggestion.'),
  ).toBeInTheDocument();
});

it('renders Arabic AI output with dir="auto" and RTL chrome', async () => {
  await i18n.changeLanguage('ar');
  setup('director', {
    [`GET /ai/suggestions/${suggestionId}`]: () =>
      ok({ ...insights, output: { ...insights.output, narrative: 'الحملة على المسار الصحيح.' } }),
  });
  renderApp(`/app/ai-review/${suggestionId}`);
  const text = await screen.findByText('الحملة على المسار الصحيح.');
  expect(text).toHaveAttribute('dir', 'auto');
  expect(document.documentElement.dir).toBe('rtl');
  expect(screen.getByRole('button', { name: 'قبول' })).toBeInTheDocument();
});

it('a supervisor can generate their own AI summary and sees the request state', async () => {
  const user = setup('supervisor', {
    'POST /ai/requests': () => [201, { data: { id: 'x', status: 'queued' } }],
  });
  const click = userEvent.setup();
  renderApp('/app/dashboard');
  await click.click(await screen.findByRole('button', { name: 'Generate AI summary' }));
  await waitFor(() => expect(api.count('POST /ai/requests')).toBe(1));
  expect(api.calls.find(({ key }) => key === 'POST /ai/requests').body).toMatchObject({
    capability: 'supervisor_daily_summary',
    subjectId: user.id,
    locale: 'en',
  });
  expect(screen.queryByRole('button', { name: 'AI insights' })).not.toBeInTheDocument();
});

it('shows each request state: waiting, ready for review, failed', async () => {
  const states = [
    [{ status: 'queued' }, 'Queued'],
    [{ status: 'sent' }, 'Waiting for the AI service'],
    [
      { status: 'completed', suggestion: { id: 's', status: 'pending_review' } },
      'Ready for review',
    ],
    [{ status: 'send_failed' }, 'Failed'],
  ];
  for (const [request, label] of states) {
    setup('supervisor', {
      'GET /ai/requests': () => ok([request], { page: 1, pageSize: 1, total: 1, enabled: true }),
    });
    const view = renderApp('/app/dashboard');
    expect(await screen.findByText(label)).toBeInTheDocument();
    view.unmount();
    api.restore();
    resetSessionForTests();
  }
});

it('hides every AI button when the module is disabled', async () => {
  setup('supervisor', {}, { enabled: false });
  renderApp('/app/dashboard');
  await screen.findByRole('heading', { name: 'Performance dashboard' });
  await waitFor(() => expect(api.count('GET /ai/requests')).toBeGreaterThan(0));
  expect(screen.queryByRole('button', { name: 'Generate AI summary' })).not.toBeInTheDocument();
});

it('campaign dashboard: no sales target disables insights and sales analysis with a tooltip', async () => {
  setup('director');
  renderApp(`/app/dashboard?campaignIds=${campaignId}`);
  const insightsButton = await screen.findByRole('button', { name: 'AI insights' });
  expect(insightsButton).toBeDisabled();
  expect(insightsButton).toHaveAttribute('title', expect.stringContaining('sales target'));
  expect(screen.getByRole('button', { name: 'AI sales analysis' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'AI coaching' })).toBeEnabled();
});

it('shows an accepted suggestion as a labelled commentary card', async () => {
  setup('director', {
    'GET /ai/commentary': ({ params }) =>
      params.capability === 'campaign_insights'
        ? ok({
            ...insights,
            status: 'accepted',
            reviewedAt: '2026-11-20T12:00:00.000Z',
            reviewedBy: { id: 'r', name: 'Amina Benali' },
          })
        : ok(null),
  });
  renderApp(`/app/dashboard?campaignIds=${campaignId}`);
  expect(await screen.findByText(/AI-generated, reviewed by Amina Benali on/)).toBeInTheDocument();
  expect(screen.getByText('The campaign is on track.')).toBeInTheDocument();
});

it('translates the notification of an arriving suggestion', async () => {
  setup('director', {
    'GET /notifications': () =>
      ok(
        [
          {
            id: 'n1',
            type: 'ai.suggestion_received',
            entityType: 'ai_suggestion',
            entityId: suggestionId,
            payload: {},
            readAt: null,
            createdAt: '2026-11-20T10:00:00.000Z',
          },
        ],
        { page: 1, pageSize: 20, total: 1 },
      ),
  });
  renderApp('/app/notifications');
  const link = await screen.findByRole('link', { name: /AI suggestion ready for review/ });
  expect(link).toHaveAttribute('href', `/app/ai-review/${suggestionId}`);
});
