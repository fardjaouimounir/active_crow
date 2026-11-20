import { randomUUID } from 'node:crypto';
import { aiServiceRequestSchema, findPiiProblems } from '@fieldflow/shared';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app.js';
import { prisma } from '../../../db/client.js';
import { createUserWithPassword } from '../../../../test/helpers/auth.js';
import { createStockWorld } from '../../inventory/__tests__/helpers.js';
import { aiConfig } from '../ai.config.js';
import { aiService } from '../ai.service.js';
import {
  INBOUND_KEY,
  OUTBOUND_KEY,
  addRules,
  addSale,
  callbackBody,
  outputs,
  postCallback,
  startFakeAi,
} from './helpers.js';

const app = createApp();
let world;
let fake;
let restore;

beforeAll(async () => {
  world = await createStockWorld(app);
  fake = await startFakeAi();
  restore = aiConfig.override({
    baseUrl: fake.url,
    inboundKey: INBOUND_KEY,
    outboundKey: OUTBOUND_KEY,
    timeoutMs: 400,
  });
});
const defaultHandler = () => ({ status: 202, body: { data: { status: 'queued' } } });
beforeEach(() => {
  fake.state.handler = defaultHandler;
});
afterAll(async () => {
  restore();
  await fake.close();
});

const trigger = (actor, body) => world.call(actor, 'post', '/ai/requests', body);
const daily = (extra = {}) => ({
  capability: 'supervisor_daily_summary',
  subjectId: world.people.supervisor.id,
  ...extra,
});
const campaignRequest = (built, capability, extra = {}) => ({
  capability,
  subjectId: built.id,
  ...extra,
});
const row = (id) => prisma.aiRequest.findUniqueOrThrow({ where: { id } });
const waitStatus = (id, status) =>
  vi.waitFor(async () => expect((await row(id)).status).toBe(status), { timeout: 4000 });
/** The AI service answers 202 and then calls our callback with `output`. */
const answerWith = (output) => {
  fake.state.handler = ({ body }) => ({
    status: 202,
    body: { data: { requestId: body.requestId, status: 'queued' } },
    after: ({ url, body: sent }) =>
      postCallback(app, callbackBody(sent.requestId, url.split('/').pop(), output)),
  });
};
const sentFor = (created) => fake.calls.filter(({ body }) => body?.requestId === created.requestId);

describe('disabled mode (no AI_SERVICE_BASE_URL)', () => {
  it('answers 503 AI_DISABLED, queues nothing and leaves other routes alone', async () => {
    const off = aiConfig.override({
      baseUrl: undefined,
      inboundKey: undefined,
      outboundKey: undefined,
    });
    try {
      const before = await prisma.aiRequest.count({ where: { agencyId: world.agency.id } });
      await world.refused(trigger('director', daily()), 503, 'AI_DISABLED');
      // Unauthenticated callers get 401 whether or not AI is enabled.
      await world.refused(
        postCallback(app, callbackBody(randomUUID(), 'campaign_insights', {})),
        401,
        'UNAUTHENTICATED',
      );
      await world.refused(
        postCallback(app, callbackBody(randomUUID(), 'campaign_insights', {}), 'x'.repeat(48)),
        401,
        'UNAUTHENTICATED',
      );
      const keysOnly = aiConfig.override({ baseUrl: undefined, outboundKey: OUTBOUND_KEY });
      await world.refused(
        postCallback(app, callbackBody(randomUUID(), 'campaign_insights', {})),
        503,
        'AI_DISABLED',
      );
      keysOnly();
      expect(await prisma.aiRequest.count({ where: { agencyId: world.agency.id } })).toBe(before);
      expect(await world.ok(world.call('director', 'get', '/reports/kpis'))).toBeTruthy();
      expect(
        await world.ok(
          world.call(
            'director',
            'get',
            `/ai/commentary?capability=campaign_insights&subjectId=${randomUUID()}&from=2026-01-01&to=2026-01-02`,
          ),
        ),
      ).toBeNull();
    } finally {
      off();
    }
  });
});

describe('POST /ai/requests', () => {
  it('rejects bad input (400), anonymous callers (401) and roles without ai.request (403)', async () => {
    await world.refused(
      trigger('director', { capability: 'chat', subjectId: 'x' }),
      400,
      'VALIDATION_FAILED',
    );
    await world.refused(trigger('director', { ...daily(), extra: 1 }), 400, 'VALIDATION_FAILED');
    await world.refused(trigger(null, daily()), 401, 'UNAUTHENTICATED');
    await world.refused(trigger('animateur', daily()), 403, 'FORBIDDEN');
    await world.refused(trigger('clientUser', daily()), 403, 'FORBIDDEN');
  });

  it('a supervisor can only request their own daily summary', async () => {
    const built = await world.campaign();
    await world.refused(
      trigger('supervisor', daily({ subjectId: world.people.supervisorTwo.id })),
      403,
      'AI_SUBJECT_NOT_ALLOWED',
    );
    await world.refused(
      trigger('supervisor', campaignRequest(built, 'animateur_coaching')),
      403,
      'AI_SUBJECT_NOT_ALLOWED',
    );
    const created = await world.ok(
      trigger('supervisor', daily({ filters: { workDate: '2000-01-01' } })),
      201,
    );
    expect(created).toMatchObject({ status: 'queued', capability: 'supervisor_daily_summary' });
  });

  it('is scoped: an unknown or out-of-scope subject is 404', async () => {
    const built = await world.campaign();
    await world.refused(trigger('director', daily({ subjectId: randomUUID() })), 404, 'NOT_FOUND');
    await world.refused(
      trigger('director', daily({ subjectId: world.people.animateur.id })),
      404,
      'NOT_FOUND',
    );
    await world.refused(
      trigger('regionalTwo', campaignRequest(built, 'animateur_coaching')),
      404,
      'NOT_FOUND',
    );
    await world.refused(
      trigger('director', campaignRequest({ id: randomUUID() }, 'animateur_coaching')),
      404,
      'NOT_FOUND',
    );
  });

  it('refuses a future work date', async () => {
    await world.refused(
      trigger('director', daily({ filters: { workDate: '2999-01-01' } })),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('AI_TARGET_REQUIRED: no sales target rule means no sales analysis or insights', async () => {
    const built = await world.campaign();
    await addRules(world, built, { target: 0 });
    for (const capability of ['sales_performance', 'campaign_insights']) {
      await world.refused(
        trigger('director', campaignRequest(built, capability)),
        422,
        'AI_TARGET_REQUIRED',
      );
    }
    expect(
      (await world.ok(trigger('director', campaignRequest(built, 'animateur_coaching')), 201))
        .status,
    ).toBe('queued');
  });

  it('returns the existing request instead of creating a second one within the hour', async () => {
    const built = await world.campaign();
    const body = campaignRequest(built, 'animateur_coaching', { locale: 'ar' });
    const first = await world.ok(trigger('director', body), 201);
    const second = await world.ok(trigger('director', body), 200);
    expect(second.id).toBe(first.id);
    const other = await world.ok(trigger('director', { ...body, locale: 'en' }), 201);
    expect(other.id).not.toBe(first.id);
    expect(await prisma.aiRequest.count({ where: { subjectId: built.id } })).toBe(2);
  });
});

describe('end to end with the fake AI service', () => {
  it('trigger → job → 202 → callback → pending_review → accept → card visible', async () => {
    const built = await world.campaign();
    const ruleSet = await addRules(world, built);
    await addSale(world, built, ruleSet, 5, 0);
    answerWith(outputs.happy.supervisor_daily_summary);

    const created = await world.ok(trigger('supervisor', daily({ locale: 'ar' })), 201);
    await waitStatus(created.id, 'completed');

    // What left the backend: the right route, the inbound key and an aggregate-only payload.
    const [call] = sentFor(created);
    expect(call.url).toBe('/v1/supervisor_daily_summary');
    expect(call.headers.authorization).toBe(`Bearer ${INBOUND_KEY}`);
    expect(aiServiceRequestSchema.safeParse(call.body).success).toBe(true);
    expect(call.body).toMatchObject({
      agencyId: world.agency.id,
      subject: { type: 'supervisor', id: world.people.supervisor.id },
      input: { text: null, fileUrl: null, context: { locale: 'ar' } },
    });
    expect(call.body.input.context.data.sales.units).toBe(5);
    expect(findPiiProblems(call.body.input.context.data)).toEqual([]);
    const people = await prisma.user.findMany({ where: { agencyId: world.agency.id } });
    for (const person of people) {
      for (const secret of [person.fullName, person.email, person.phone].filter(Boolean)) {
        expect(call.text, `payload contains ${secret}`).not.toContain(secret);
      }
    }

    const stored = await prisma.aiSuggestion.findUniqueOrThrow({
      where: { requestId: created.requestId },
    });
    expect(stored).toMatchObject({
      status: 'pending_review',
      capability: 'supervisor_daily_summary',
      subjectType: 'supervisor',
      subjectId: world.people.supervisor.id,
      modelVersion: 'Qwen/Qwen3.8-27B@prompt-v1',
    });
    expect(Number(stored.confidence)).toBe(0.95);
    expect(stored.output.headline).toContain('Attendance');
    expect(await row(created.id)).toMatchObject({ attempts: 1, completedAt: expect.any(Date) });

    // Reviewers see it with backend KPIs beside it; supervisors cannot review.
    const detail = await world.ok(world.call('director', 'get', `/ai/suggestions/${stored.id}`));
    expect(detail).toMatchObject({
      status: 'pending_review',
      subjectName: world.people.supervisor.fullName,
    });
    expect(detail.kpis.sales.units).toBe(5);
    await world.refused(
      world.call('supervisor', 'get', `/ai/suggestions/${stored.id}`),
      403,
      'FORBIDDEN',
    );
    await world.refused(
      world.call('supervisor', 'post', `/ai/suggestions/${stored.id}/accept`, {}),
      403,
      'FORBIDDEN',
    );
    const card = `/ai/commentary?capability=supervisor_daily_summary&subjectId=${world.people.supervisor.id}&from=${created.filters.from}&to=${created.filters.to}`;
    expect(await world.ok(world.call('supervisor', 'get', card))).toBeNull();

    await world.refused(
      world.call('director', 'post', `/ai/suggestions/${stored.id}/reject`, {}),
      400,
      'VALIDATION_FAILED',
    );
    await world.ok(
      world.call('director', 'post', `/ai/suggestions/${stored.id}/accept`, {
        note: 'Looks right',
      }),
    );
    const reviewed = await prisma.aiSuggestion.findUniqueOrThrow({ where: { id: stored.id } });
    expect(reviewed).toMatchObject({
      status: 'accepted',
      reviewedById: world.people.director.id,
      reviewNote: 'Looks right',
      reviewedAt: expect.any(Date),
    });
    await world.refused(
      world.call('director', 'post', `/ai/suggestions/${stored.id}/reject`, { note: 'late' }),
      422,
      'AI_SUGGESTION_NOT_PENDING',
    );
    expect(
      await prisma.auditLog.count({
        where: { entityId: stored.id, action: 'ai.suggestion_accepted' },
      }),
    ).toBe(1);

    const commentary = await world.ok(world.call('supervisor', 'get', card));
    expect(commentary).toMatchObject({
      id: stored.id,
      status: 'accepted',
      reviewedBy: { name: world.people.director.fullName },
    });
    expect(commentary.output.headline).toBeTruthy();
    // A suggestion made for another period is never shown for this one.
    expect(
      await world.ok(world.call('supervisor', 'get', card.replace(/to=.*$/, 'to=2000-01-01'))),
    ).toBeNull();
    // Another supervisor has no access to this card.
    expect(await world.ok(world.call('supervisorTwo', 'get', card))).toBeNull();

    // The requester is told about the decision; the reviewers were told about the arrival.
    await vi.waitFor(async () => {
      const types = (await prisma.notification.findMany({ where: { entityId: stored.id } })).map(
        ({ userId, type }) => `${userId}:${type}`,
      );
      expect(types).toContain(`${world.people.supervisor.id}:ai.suggestion_reviewed`);
      expect(types).toContain(`${world.people.director.id}:ai.suggestion_received`);
    });
  });

  it('campaign capabilities send their own shapes and subject type', async () => {
    const built = await world.campaign();
    const ruleSet = await addRules(world, built);
    await addSale(world, built, ruleSet, 8, 1);
    for (const capability of ['sales_performance', 'campaign_insights', 'animateur_coaching']) {
      answerWith(outputs.happy[capability]);
      const created = await world.ok(trigger('director', campaignRequest(built, capability)), 201);
      await waitStatus(created.id, 'completed');
      const [{ body, url }] = sentFor(created);
      expect(url).toBe(`/v1/${capability}`);
      expect(body.subject).toEqual({ type: 'campaign', id: built.id });
      expect(aiServiceRequestSchema.safeParse(body).success).toBe(true);
      const { data } = body.input.context;
      if (capability === 'campaign_insights') {
        expect(data.sales).toMatchObject({ units: 8 });
        expect(data.sales.target).toBeGreaterThan(0);
      } else if (capability === 'sales_performance') {
        expect(data.sellers[0]).toMatchObject({ label: 'S1', units: 8 });
        expect(data.periods.length).toBeGreaterThan(0);
      } else {
        expect(data.animateurs[0]).toMatchObject({ label: 'A1', units: 8 });
      }
      // Labels stay on our side: ids only in label_map, never in the payload.
      const saved = await row(created.id);
      if (capability !== 'campaign_insights') {
        expect(Object.keys(saved.labelMap).length).toBeGreaterThan(0);
        expect(JSON.stringify(body)).not.toContain(built.animateur.id);
      }
    }
    const coaching = await prisma.aiRequest.findFirstOrThrow({
      where: { subjectId: built.id, capability: 'animateur_coaching' },
    });
    expect(coaching.labelMap).toEqual({ A1: built.animateur.id });
    const suggestion = await prisma.aiSuggestion.findFirstOrThrow({
      where: { requestId: coaching.requestId },
    });
    const detail = await world.ok(
      world.call('director', 'get', `/ai/suggestions/${suggestion.id}`),
    );
    expect(detail.labels.A1).toEqual({
      type: 'user',
      id: built.animateur.id,
      name: built.animateur.fullName,
    });
  });

  it('stores error outputs and Arabic output as pending_review and flags the fallback', async () => {
    const built = await world.campaign();
    await addRules(world, built);
    const cases = [
      ['empty', outputs.empty, 'none@no-data', 'NEEDS_DATA'],
      ['malformed', outputs.malformedOutput, 'none@no-data', 'AI_VALIDATION_FAILED'],
      ['provider', outputs.providerError, 'none@no-data', 'AI_UNAVAILABLE'],
      ['arabic', outputs.arabic, 'Qwen/Qwen3.8-27B@deterministic-fallback@prompt-v1', null],
    ];
    for (const [index, [, output, modelVersion, failure]] of cases.entries()) {
      const created = await world.ok(
        trigger(
          'director',
          campaignRequest(built, 'animateur_coaching', {
            filters: { from: `2026-01-0${index + 1}`, to: '2026-01-09' },
          }),
        ),
        201,
      );
      const delivered = await postCallback(
        app,
        callbackBody(created.requestId, 'animateur_coaching', output, {
          modelVersion,
          confidence: 0.4,
        }),
      );
      expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
      const suggestion = await prisma.aiSuggestion.findUniqueOrThrow({
        where: { requestId: created.requestId },
      });
      expect(suggestion.status).toBe('pending_review');
      const view = await world.ok(
        world.call('director', 'get', `/ai/suggestions/${suggestion.id}`),
      );
      expect(view).toMatchObject({
        failure,
        fallback: modelVersion.includes('deterministic-fallback'),
      });
    }
  });

  it('the PII firewall error is stored and logged as an error on our side', async () => {
    const built = await world.campaign();
    await addRules(world, built);
    const created = await world.ok(
      trigger('director', campaignRequest(built, 'animateur_coaching')),
      201,
    );
    const delivered = await postCallback(
      app,
      callbackBody(created.requestId, 'animateur_coaching', outputs.piiFirewall, {
        modelVersion: 'none@pii-firewall',
      }),
    );
    expect(delivered.status).toBe(200);
    expect(
      (await prisma.aiSuggestion.findUniqueOrThrow({ where: { requestId: created.requestId } }))
        .output.error.code,
    ).toBe('PII_FIREWALL');
  });
});

describe('cost guard and daily cap', () => {
  it('reuses a completed request (and its suggestion) within the hour', async () => {
    const built = await world.campaign();
    await addRules(world, built);
    const body = campaignRequest(built, 'animateur_coaching');
    const first = await world.ok(trigger('director', body), 201);
    await postCallback(
      app,
      callbackBody(first.requestId, 'animateur_coaching', outputs.happy.animateur_coaching),
    );
    const again = await world.ok(trigger('director', body), 200);
    expect(again).toMatchObject({ id: first.id, status: 'completed' });
    expect(again.suggestion).toMatchObject({ status: 'pending_review' });
  });

  it('429 AI_DAILY_LIMIT_REACHED after the per-user daily cap (reuse does not count)', async () => {
    const built = await world.campaign();
    await addRules(world, built);
    const user = world.people.general;
    const used = await prisma.aiRequest.count({ where: { requestedById: user.id } });
    const restoreLimit = aiConfig.override({
      ...aiConfig.get(),
      dailyLimit: used + 1,
    });
    try {
      const body = campaignRequest(built, 'animateur_coaching');
      await world.ok(trigger('general', body), 201);
      await world.ok(trigger('general', body), 200);
      await world.refused(
        trigger('general', { ...body, filters: { from: '2026-01-01', to: '2026-01-03' } }),
        429,
        'AI_DAILY_LIMIT_REACHED',
      );
    } finally {
      restoreLimit();
    }
  });

  it('408 from the AI service is retryable', async () => {
    const created = await prisma.aiRequest.create({
      data: {
        requestId: randomUUID(),
        agencyId: world.agency.id,
        capability: 'supervisor_daily_summary',
        subjectType: 'supervisor',
        subjectId: world.people.supervisor.id,
        filters: {
          supervisorIds: [world.people.supervisor.id],
          from: '2026-01-05',
          to: '2026-01-05',
          workDate: '2026-01-05',
          locale: 'en',
        },
        requestedById: world.people.director.id,
      },
    });
    fake.state.handler = ({ body }) =>
      body.requestId === created.requestId ? { status: 408 } : { status: 202, body: {} };
    await expect(
      aiService.processRequest({ aiRequestId: created.id }, { retryCount: 0, retryLimit: 5 }),
    ).rejects.toThrow(/408/);
    expect((await row(created.id)).status).toBe('queued');
  });
});

describe('review hardening', () => {
  it('a failed output can only be rejected; a NUL byte in the output is stored safely', async () => {
    const built = await world.campaign();
    await addRules(world, built);
    const created = await world.ok(
      trigger('director', campaignRequest(built, 'animateur_coaching')),
      201,
    );
    await postCallback(
      app,
      callbackBody(created.requestId, 'animateur_coaching', {
        error: { code: 'NEEDS_DATA', message: 'x y' },
      }),
    );
    const suggestion = await prisma.aiSuggestion.findFirstOrThrow({
      where: { requestId: created.requestId },
    });
    await world.refused(
      world.call('director', 'post', `/ai/suggestions/${suggestion.id}/accept`, {}),
      422,
      'BUSINESS_RULE_VIOLATION',
    );
    await world.ok(
      world.call('director', 'post', `/ai/suggestions/${suggestion.id}/reject`, {
        note: 'no data',
      }),
    );
  });

  it('the cost guard is per requester: a regional request is not reused for a director', async () => {
    const built = await world.campaign();
    await addRules(world, built);
    const body = campaignRequest(built, 'animateur_coaching');
    const regional = await world.ok(trigger('regional', body), 201);
    const director = await world.ok(trigger('director', body), 201);
    expect(director.id).not.toBe(regional.id);
  });

  it('a callback with a malformed output.error is a 400', async () => {
    await world.refused(
      postCallback(app, callbackBody(randomUUID(), 'animateur_coaching', { error: { code: 5 } })),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('final report', () => {
  const summaryRows = async (built) => {
    const response = await world
      .call('director', 'get', `/reports/campaigns/${built.id}/export.xlsx`)
      .buffer(true)
      .parse((res, done) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(response.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    const rows = [];
    workbook.getWorksheet('Summary').eachRow((row) => rows.push(row.values.slice(1)));
    return rows;
  };

  it('the Excel Summary shows an accepted AI narrative, labelled, and never a pending one', async () => {
    const built = await world.campaign();
    await addRules(world, built);
    const created = await world.ok(
      trigger(
        'director',
        campaignRequest(built, 'campaign_insights', {
          filters: {
            from: built.campaign.startDate.toISOString().slice(0, 10),
            to: built.campaign.endDate.toISOString().slice(0, 10),
          },
        }),
      ),
      201,
    );
    await postCallback(
      app,
      callbackBody(created.requestId, 'campaign_insights', outputs.happy.campaign_insights),
    );
    const isAi = (row) => String(row[0]).startsWith('AI commentary');
    expect((await summaryRows(built)).some(isAi)).toBe(false);
    const suggestion = await prisma.aiSuggestion.findFirstOrThrow({
      where: { requestId: created.requestId },
    });
    await world.ok(world.call('director', 'post', `/ai/suggestions/${suggestion.id}/accept`, {}));
    const [row] = (await summaryRows(built)).filter(isAi);
    expect(row[0]).toContain(`AI-generated, reviewed by ${world.people.director.fullName} on `);
    expect(row[1]).toContain('The campaign is on track.');
    expect(row[1]).toContain('Gift stock is low');
  });
});

describe('POST /internal/ai/results', () => {
  let request;
  beforeAll(async () => {
    const built = await world.campaign();
    await addRules(world, built);
    request = await world.ok(
      trigger('director', campaignRequest(built, 'animateur_coaching')),
      201,
    );
  });
  const valid = () =>
    callbackBody(request.requestId, 'animateur_coaching', outputs.happy.animateur_coaching);

  it('401 without the service key, with a wrong key or with a user JWT', async () => {
    await world.refused(postCallback(app, valid(), null), 401, 'UNAUTHENTICATED');
    await world.refused(postCallback(app, valid(), 'x'.repeat(48)), 401, 'UNAUTHENTICATED');
    await world.refused(postCallback(app, valid(), INBOUND_KEY), 401, 'UNAUTHENTICATED');
    const userToken = world.auth.director.Authorization.replace('Bearer ', '');
    await world.refused(postCallback(app, valid(), userToken), 401, 'UNAUTHENTICATED');
    expect(await prisma.aiSuggestion.count({ where: { requestId: request.requestId } })).toBe(0);
  });

  it('the service key is not accepted on user routes', async () => {
    const res = await world.call(
      { Authorization: `Bearer ${OUTBOUND_KEY}` },
      'get',
      '/ai/requests',
    );
    expect(res.status).toBe(401);
  });

  it('422 for an unknown requestId and for a capability mismatch (nothing stored)', async () => {
    await world.refused(
      postCallback(app, callbackBody(randomUUID(), 'animateur_coaching', {})),
      422,
      'AI_REQUEST_NOT_FOUND',
    );
    await world.refused(
      postCallback(app, callbackBody(request.requestId, 'campaign_insights', {})),
      422,
      'AI_CAPABILITY_MISMATCH',
    );
    expect(await prisma.aiSuggestion.count({ where: { requestId: request.requestId } })).toBe(0);
  });

  it('400 for a body outside the strict contract', async () => {
    for (const body of [
      { ...valid(), agencyId: world.agency.id },
      { ...valid(), confidence: 2 },
      { ...valid(), modelVersion: 'x'.repeat(121) },
      { ...valid(), output: [] },
      { requestId: 'nope' },
    ]) {
      await world.refused(postCallback(app, body), 400, 'VALIDATION_FAILED');
    }
  });

  it('413 for a body over 256 KB', async () => {
    const big = callbackBody(request.requestId, 'animateur_coaching', {
      blob: 'x'.repeat(300_000),
    });
    const res = await postCallback(app, big);
    expect(res.status).toBe(413);
  });

  it('a duplicate callback answers 200 and leaves exactly one row', async () => {
    const first = await postCallback(app, valid());
    expect(first.body.data.status).toBe('stored');
    const second = await postCallback(app, { ...valid(), confidence: 0.1, output: { other: 1 } });
    expect(second.status).toBe(200);
    expect(second.body.data.status).toBe('duplicate');
    const rows = await prisma.aiSuggestion.findMany({ where: { requestId: request.requestId } });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].confidence)).toBe(0.95);
    expect((await row(request.id)).status).toBe('completed');
  });

  it('the database refuses to edit or delete a suggestion outside a review', async () => {
    const suggestion = await prisma.aiSuggestion.findFirstOrThrow({
      where: { requestId: request.requestId },
    });
    await expect(
      prisma.aiSuggestion.update({
        where: { id: suggestion.id },
        data: { output: { edited: true } },
      }),
    ).rejects.toThrow();
    await expect(prisma.aiSuggestion.delete({ where: { id: suggestion.id } })).rejects.toThrow();
    await expect(
      prisma.aiSuggestion.update({
        where: { id: suggestion.id },
        data: { status: 'pending_review' },
      }),
    ).rejects.toThrow();
  });
});

describe('outbound job (processRequest)', () => {
  const make = (extra = {}) =>
    prisma.aiRequest.create({
      data: {
        requestId: randomUUID(),
        agencyId: world.agency.id,
        capability: 'supervisor_daily_summary',
        subjectType: 'supervisor',
        subjectId: world.people.supervisor.id,
        filters: {
          supervisorIds: [world.people.supervisor.id],
          from: '2026-01-05',
          to: '2026-01-05',
          workDate: '2026-01-05',
          locale: 'en',
        },
        requestedById: world.people.director.id,
        ...extra,
      },
    });
  /** The n-th call about `created` gets the n-th reply (the last one repeats). */
  const reply = (created, ...replies) => {
    let seen = 0;
    fake.state.handler = ({ body }) =>
      body.requestId === created.requestId
        ? replies[Math.min(seen++, replies.length - 1)]
        : accepted();
  };
  const accepted = (status = 'queued') => ({ status: 202, body: { data: { status } } });

  it('202 queued and 202 cached both mean sent', async () => {
    for (const status of ['queued', 'cached']) {
      const created = await make();
      reply(created, accepted(status));
      await aiService.processRequest({ aiRequestId: created.id });
      expect(await row(created.id)).toMatchObject({
        status: 'sent',
        sentAt: expect.any(Date),
        attempts: 1,
      });
    }
  });

  it('400 and 401 are permanent: send_failed, no retry', async () => {
    for (const status of [400, 401]) {
      const created = await make();
      reply(created, { status, body: { error: { message: 'bad' } } });
      await aiService.processRequest({ aiRequestId: created.id }, { retryLimit: 5 });
      expect(await row(created.id)).toMatchObject({ status: 'send_failed' });
      expect((await row(created.id)).lastError).toContain(String(status));
    }
  });

  it('429 throws so the queue retries, then 202 reuses the same requestId', async () => {
    const created = await make();
    reply(created, { status: 429 }, accepted());
    await expect(
      aiService.processRequest({ aiRequestId: created.id }, { retryCount: 0, retryLimit: 5 }),
    ).rejects.toThrow(/429/);
    expect(await row(created.id)).toMatchObject({ status: 'queued', attempts: 1 });
    await aiService.processRequest({ aiRequestId: created.id }, { retryCount: 1, retryLimit: 5 });
    expect((await row(created.id)).status).toBe('sent');
    expect(sentFor(created)).toHaveLength(2);
  });

  it('a 5xx on the last attempt ends in send_failed', async () => {
    const created = await make();
    reply(created, { status: 503 });
    await expect(
      aiService.processRequest({ aiRequestId: created.id }, { retryCount: 5, retryLimit: 5 }),
    ).rejects.toThrow(/503/);
    expect((await row(created.id)).status).toBe('send_failed');
  });

  it('a timeout is transient', async () => {
    const created = await make();
    reply(created, { ...accepted(), delayMs: 1200 });
    await expect(
      aiService.processRequest({ aiRequestId: created.id }, { retryCount: 0, retryLimit: 5 }),
    ).rejects.toThrow(/timeout/);
    expect(await row(created.id)).toMatchObject({
      status: 'queued',
      lastError: 'AI service timeout',
    });
  });

  it('does nothing for a request that is no longer queued, or whose requester left', async () => {
    const sent = await make({ status: 'sent' });
    const left = await createUserWithPassword(world.agency.id, {
      role: 'director',
      status: 'suspended',
    });
    const gone = await make({ requestedById: left.id });
    await aiService.processRequest({ aiRequestId: sent.id });
    await aiService.processRequest({ aiRequestId: gone.id });
    expect(sentFor(sent)).toHaveLength(0);
    expect(sentFor(gone)).toHaveLength(0);
    expect((await row(gone.id)).status).toBe('send_failed');
  });
});

describe('scope of requests and suggestions', () => {
  it('lists only what the actor may see; supervisors see their own requests', async () => {
    const built = await world.campaign();
    await addRules(world, built);
    const own = await world.ok(
      trigger('regional', campaignRequest(built, 'animateur_coaching')),
      201,
    );
    const supervisorOwn = await world.ok(
      trigger('supervisor', daily({ filters: { workDate: '2001-01-01' } })),
      201,
    );

    const ids = async (actor, path = '/ai/requests?pageSize=100') =>
      (await world.call(actor, 'get', path)).body.data.map(({ id }) => id);
    expect(await ids('director')).toEqual(expect.arrayContaining([own.id, supervisorOwn.id]));
    expect(await ids('regional')).toContain(own.id);
    expect(await ids('regionalTwo')).not.toContain(own.id);
    const supervisorSees = await ids('supervisor');
    expect(supervisorSees).toContain(supervisorOwn.id);
    expect(supervisorSees).not.toContain(own.id);
    await world.refused(world.call('animateur', 'get', '/ai/requests'), 403, 'FORBIDDEN');
    await world.refused(world.call('supervisor', 'get', '/ai/suggestions'), 403, 'FORBIDDEN');
    await world.refused(
      world.call('director', 'get', '/ai/requests?status=bogus'),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('suggestions: agency level sees all, a regional manager only their own, others 404', async () => {
    const built = await world.campaign();
    await addRules(world, built);
    const mine = await world.ok(
      trigger('regional', campaignRequest(built, 'animateur_coaching')),
      201,
    );
    await postCallback(
      app,
      callbackBody(mine.requestId, 'animateur_coaching', outputs.happy.animateur_coaching),
    );
    const suggestion = await prisma.aiSuggestion.findFirstOrThrow({
      where: { requestId: mine.requestId },
    });
    const path = `/ai/suggestions/${suggestion.id}`;
    await world.ok(world.call('director', 'get', path));
    await world.ok(world.call('general', 'get', path));
    await world.ok(world.call('regional', 'get', path));
    await world.refused(world.call('regionalTwo', 'get', path), 404, 'NOT_FOUND');
    await world.refused(world.call('regionalTwo', 'post', `${path}/accept`, {}), 404, 'NOT_FOUND');
    const listed = await world.call('regionalTwo', 'get', '/ai/suggestions?pageSize=100');
    expect(listed.body.data.map(({ id }) => id)).not.toContain(suggestion.id);
    const filtered = await world.call(
      'director',
      'get',
      `/ai/suggestions?capability=animateur_coaching&status=pending_review&subjectId=${built.id}`,
    );
    expect(filtered.body.data.map(({ id }) => id)).toContain(suggestion.id);
    expect(filtered.body.meta).toMatchObject({ page: 1 });
    // Campaign-wide commentary is not shown to a supervisor.
    await world.ok(world.call('regional', 'post', `${path}/reject`, { note: 'not useful' }));
    expect(
      await world.ok(
        world.call(
          'supervisor',
          'get',
          `/ai/commentary?capability=animateur_coaching&subjectId=${built.id}&from=${mine.filters.from}&to=${mine.filters.to}`,
        ),
      ),
    ).toBeNull();
  });
});

describe('daily scheduler', () => {
  it('creates one daily summary per supervisor with something expected and skips the rest', async () => {
    const built = await world.campaign();
    await addRules(world, built);
    const result = await aiService.scheduleDailySummaries({ agencyId: world.agency.id });
    expect(result.created).toBe(1);
    const scheduled = await prisma.aiRequest.findMany({
      where: {
        agencyId: world.agency.id,
        requestedById: null,
        subjectId: world.people.supervisor.id,
      },
    });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({
      capability: 'supervisor_daily_summary',
      subjectType: 'supervisor',
    });
    expect(scheduled[0].filters.locale).toBe('ar');
    // Running it again within the hour creates nothing new (cost guard).
    expect(await aiService.scheduleDailySummaries({ agencyId: world.agency.id })).toEqual({
      created: 0,
    });
  });
});
