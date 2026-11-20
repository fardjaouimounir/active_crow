import { calculateKpis, findPiiProblems } from '@fieldflow/shared';
import { describe, expect, it } from 'vitest';
import {
  AiPayloadError,
  animateurCoaching,
  assemblePayload,
  campaignInsights,
  salesPerformance,
  supervisorDailySummary,
  validatePayload,
} from '../aiPayloads.js';

const period = { from: '2026-11-01', to: '2026-11-20' };
const kpis = (totals) => calculateKpis(period, totals);
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';

// The aggregates of the HANDOFF happy fixture, expressed as the reporting KPI inputs.
const day = kpis({
  verified: 30,
  pending: 12,
  expectedSlots: 50,
  salesUnits: 120,
  entitledUnits: 100,
  distributedUnits: 80,
});
const lastWeek = kpis({ salesUnits: 100 });
const campaign = kpis({
  verified: 30,
  pending: 12,
  expectedSlots: 50,
  salesUnits: 120,
  salesTarget: 150,
  entitledUnits: 100,
  distributedUnits: 80,
});
const person = (id, totals) => ({ id, ...kpis(totals) });
const dayRow = (id, units) => ({ id, ...kpis({ salesUnits: units }) });

describe('payload builders', () => {
  it('supervisor_daily_summary: present = verified + pending, previous = same weekday last week', () => {
    expect(supervisorDailySummary({ today: day, previous: lastWeek })).toEqual({
      data: {
        attendance: { present: 42, expected: 50 },
        sales: { units: 120, previousUnits: 100 },
        gifts: { distributed: 80, planned: 100 },
      },
      labelMap: {},
    });
  });

  it('sales_performance: sellers S1… by units with target, periods P1… ascending', () => {
    const result = salesPerformance({
      total: campaign,
      animateurs: [
        person(B, { salesUnits: 80, salesTarget: 100 }),
        person(A, { salesUnits: 120, salesTarget: 100 }),
      ],
      daily: [dayRow('2026-11-02', 110), dayRow('2026-11-01', 90)],
    });
    expect(result.data).toEqual({
      sellers: [
        { label: 'S1', units: 120, target: 100 },
        { label: 'S2', units: 80, target: 100 },
      ],
      periods: [
        { label: 'P1', units: 90 },
        { label: 'P2', units: 110 },
      ],
    });
    expect(result.labelMap).toEqual({ S1: A, S2: B, P1: '2026-11-01', P2: '2026-11-02' });
  });

  it('sales_performance: omits an unknown per-seller target and never sends null', () => {
    const { data } = salesPerformance({
      total: campaign,
      animateurs: [person(A, { salesUnits: 5 })],
      daily: [],
    });
    expect(data.sellers).toEqual([{ label: 'S1', units: 5 }]);
    expect(JSON.stringify(data)).not.toContain('null');
  });

  it('sales_performance and campaign_insights need a campaign sales target', () => {
    const noTarget = kpis({ salesUnits: 10 });
    for (const build of [
      () => salesPerformance({ total: noTarget, animateurs: [], daily: [] }),
      () => campaignInsights({ total: noTarget }),
    ]) {
      expect(build).toThrowError(AiPayloadError);
      expect(build).toThrowError(/no sales target/);
    }
  });

  it('weekly periods when the range exceeds 31 days', () => {
    const days = Array.from({ length: 35 }, (_, index) =>
      dayRow(new Date(Date.UTC(2026, 9, 5 + index)).toISOString().slice(0, 10), 1),
    );
    const { data, labelMap } = salesPerformance({ total: campaign, animateurs: [], daily: days });
    expect(data.periods).toEqual([
      { label: 'P1', units: 7 },
      { label: 'P2', units: 7 },
      { label: 'P3', units: 7 },
      { label: 'P4', units: 7 },
      { label: 'P5', units: 7 },
    ]);
    expect(labelMap.P1).toBe('2026-10-05');
  });

  it('campaign_insights: campaign totals with the rule target', () => {
    expect(campaignInsights({ total: campaign }).data).toEqual({
      attendance: { present: 42, expected: 50 },
      sales: { units: 120, target: 150 },
      gifts: { distributed: 80, planned: 100 },
    });
  });

  it('animateur_coaching: A1… with rate, units, visits; unknown values omitted', () => {
    const result = animateurCoaching({
      animateurs: [
        person(B, {
          verified: 7,
          expectedSlots: 10,
          salesUnits: 80,
          salesTarget: 100,
          visitCount: 2,
        }),
        person(A, {
          verified: 9,
          expectedSlots: 10,
          salesUnits: 120,
          salesTarget: 100,
          visitCount: 4,
        }),
        person(C, { expectedSlots: 0, salesUnits: 0 }),
      ],
    });
    expect(result.data.animateurs).toEqual([
      { label: 'A1', attendanceRate: 0.9, units: 120, target: 100, visits: 4 },
      { label: 'A2', attendanceRate: 0.7, units: 80, target: 100, visits: 2 },
    ]);
    expect(result.labelMap).toEqual({ A1: A, A2: B });
    const without = animateurCoaching({ animateurs: [person(A, { salesUnits: 3 })] });
    expect(without.data.animateurs).toEqual([{ label: 'A1', units: 3, visits: 0 }]);
  });

  it('labels are stable inside one request and the label map round-trips', () => {
    const rows = [person(A, { salesUnits: 50 }), person(B, { salesUnits: 10 })];
    const first = animateurCoaching({ animateurs: rows });
    // A retry after the numbers changed keeps everybody under the label already stored.
    const swapped = [person(A, { salesUnits: 1, expectedSlots: 1 }), person(B, { salesUnits: 99 })];
    const retry = animateurCoaching({ animateurs: swapped, existing: first.labelMap });
    expect(retry.labelMap).toEqual(first.labelMap);
    expect(retry.data.animateurs.map(({ label }) => label).sort()).toEqual(['A1', 'A2']);
    const newcomer = animateurCoaching({
      animateurs: [...rows, person(C, { salesUnits: 1 })],
      existing: first.labelMap,
    });
    expect(newcomer.labelMap).toEqual({ ...first.labelMap, A3: C });
  });

  it('no id, name or url appears anywhere in a built payload', () => {
    const { data } = animateurCoaching({ animateurs: [person(A, { salesUnits: 1 })] });
    expect(JSON.stringify(data)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(findPiiProblems(data)).toEqual([]);
  });
});

describe('validatePayload (contract schema + PII guard)', () => {
  const base = {
    capability: 'supervisor_daily_summary',
    requestId: '00000000-0000-4000-8000-000000000001',
    agencyId: '11111111-1111-4111-8111-111111111111',
    subjectId: A,
    locale: 'en',
    context: { workDate: '2026-11-20', from: '2026-11-20', to: '2026-11-20' },
    data: { attendance: { present: 1, expected: 2 } },
  };

  it('accepts a well-formed payload', () => {
    expect(validatePayload(base.capability, assemblePayload(base)).subject.type).toBe('supervisor');
  });

  it('rejects a phone-shaped label (PII guard)', () => {
    const body = assemblePayload({
      ...base,
      capability: 'animateur_coaching',
      data: { animateurs: [{ label: '0555 123 456', units: 1 }] },
    });
    expect(() => validatePayload('animateur_coaching', body)).toThrowError(/PII guard/);
  });

  it('rejects forbidden keys, emails, urls and long strings', () => {
    for (const data of [
      { name: 'x' },
      { rows: [{ label: 'a@b.dz' }] },
      { link: 'https://example.com' },
      { text: 'x'.repeat(201) },
    ]) {
      expect(() => validatePayload(base.capability, assemblePayload({ ...base, data }))).toThrow();
    }
  });

  it('rejects a wrong subject type and unknown fields', () => {
    expect(() =>
      validatePayload(
        'sales_performance',
        assemblePayload({ ...base, capability: base.capability }),
      ),
    ).toThrowError(/subject type/);
    expect(() =>
      validatePayload(base.capability, { ...assemblePayload(base), extra: true }),
    ).toThrowError(/contract/);
  });
});
