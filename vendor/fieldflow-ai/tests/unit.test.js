import { describe, it, expect } from 'vitest';
import { supervisorDailyKpis, salesPerformanceKpis, computeRanking, computeCompleteness } from '../src/pipeline/kpis.js';
import { checkNumbers, allowedNumbers } from '../src/pipeline/number-check.js';
import { computeConfidence } from '../src/pipeline/confidence.js';
import { RequestSchema } from '../src/schemas/request.js';
import { OutputSchemas } from '../src/schemas/outputs.js';
import { getCapability, prepareReportData } from '../src/capabilities/index.js';
import { createPipeline } from '../src/pipeline/index.js';
import { createLlm } from '../src/pipeline/llm.js';
import { createCallback } from '../src/pipeline/callback.js';
import fixture from '../fixtures/supervisor_daily_summary/happy.json' with { type: 'json' };

describe('KPI computation', () => {
  it('computes exact daily-report KPIs', () => {
    const kpis = supervisorDailyKpis(fixture.input.context.data);
    expect(kpis.attendanceRate).toBe(0.84);
    expect(kpis.unitsDeltaPct).toBe(20);
    expect(kpis.giftDistributionRate).toBe(0.8);
  });

  it('computes code-derived gap counts so the model can cite them safely', () => {
    const kpis = supervisorDailyKpis(fixture.input.context.data);
    expect(kpis.missingCount).toBe(8);
    expect(kpis.giftGap).toBe(20);
    const sales = salesPerformanceKpis({ sellers: [{ units: 80, target: 100 }], periods: [] });
    expect(sales.targetGap).toBe(20);
  });

  it('computes sales totals and code-derived ranking', () => {
    const data = {
      sellers: [
        { label: 'S1', units: 120, target: 100 },
        { label: 'S2', units: 80, target: 100 },
      ],
      periods: [{ label: 'P1', units: 90 }],
    };
    const kpis = salesPerformanceKpis(data);
    expect(kpis.totalUnits).toBe(200);
    expect(kpis.targetAttainmentPct).toBe(100);
    expect(computeRanking(data)).toEqual(['S1', 'S2']);
  });

  it('omits undefined metrics (never 0) for missing data and measures completeness', () => {
    const kpis = supervisorDailyKpis({});
    expect(kpis).toEqual({});
    expect(computeCompleteness('supervisor_daily_summary', {})).toBe(0);
    expect(computeCompleteness('supervisor_daily_summary', fixture.input.context.data)).toBe(1);
  });
});

describe('number fidelity', () => {
  const kpis = supervisorDailyKpis(fixture.input.context.data);
  const output = {
    headline: 'Attendance 84 percent; units 120.',
    summary: ['Attendance reached 84 percent of 50 expected.'],
    kpis,
  };

  it('accepts numerals that exist in the KPI object', () => {
    expect(checkNumbers(output, kpis).ok).toBe(true);
  });

  it('rejects an invented numeral', () => {
    const bad = { ...output, headline: 'Attendance 99 percent.' };
    const result = checkNumbers(bad, kpis);
    expect(result.ok).toBe(false);
    expect(result.offending).toContain('99');
  });

  it('normalises Arabic-Indic digits before checking', () => {
    const arabic = { ...output, headline: 'الحضور ٩٩ بالمئة.' };
    expect(checkNumbers(arabic, kpis).ok).toBe(false);
  });
});

describe('confidence', () => {
  it('is in [0,1] with 3 decimals and reflects completeness and validation', () => {
    expect(computeConfidence(1, true)).toBe(1);
    expect(computeConfidence(0.5, true)).toBe(0.5);
    // Template output is not AI output: no AI confidence at all.
    expect(computeConfidence(0.5, false)).toBe(0);
    expect(computeConfidence(1, 'fallback')).toBe(0);
    expect(computeConfidence(1, 'repaired')).toBe(0.85);
    expect(computeConfidence(2, true)).toBe(1);
  });
});

describe('strict schemas', () => {
  it('rejects an unknown request field', () => {
    expect(RequestSchema.safeParse({ ...fixture, surprise: 1 }).success).toBe(false);
  });

  it('accepts the documented happy fixture', () => {
    expect(RequestSchema.safeParse(fixture).success).toBe(true);
  });

  it('validates every capability fallback against its output schema', () => {
    for (const id of ['supervisor_daily_summary', 'sales_performance', 'campaign_insights', 'animateur_coaching']) {
      const cap = getCapability(id);
      const kpis = cap.computeKpis({});
      const out = cap.fallback('en', kpis, []);
      expect(OutputSchemas[id].safeParse(out).success, id).toBe(true);
    }
  });
});

describe('PII firewall', () => {
  const happyData = {
    campaign: { code: 'CMP-1' },
    attendance: { expected: 50, verified: 42, pending: 1, late: 2, notSubmitted: 0, absentJustified: 0 },
    sales: { totalUnits: 120, previousDayTotalUnits: 100, byAnimateur: [{ label: 'A1', pointOfSale: 'PDV-031', units: 54 }] },
  };

  it('passes counts, codes and short labels through unchanged', () => {
    expect(prepareReportData('supervisor_daily_summary', happyData)).toEqual(happyData);
  });

  it('rejects phone-shaped values', () => {
    expect(() => prepareReportData('supervisor_daily_summary', { ...happyData, contact: '+1-555-0100' })).toThrow(/PII_FIREWALL/);
  });

  it('rejects email-shaped values', () => {
    expect(() => prepareReportData('supervisor_daily_summary', { ...happyData, email: 'a@b.com' })).toThrow(/PII_FIREWALL/);
  });

  it('rejects URLs', () => {
    expect(() => prepareReportData('supervisor_daily_summary', { ...happyData, photo: 'https://x/img.jpg' })).toThrow(/PII_FIREWALL/);
  });

  it('rejects forbidden keys (name, exif, base64)', () => {
    expect(() => prepareReportData('supervisor_daily_summary', { ...happyData, name: 'Jane', exif: 'GPS', base64: 'AAAA' })).toThrow(/PII_FIREWALL/);
  });

  it('rejects strings over the length cap', () => {
    expect(() => prepareReportData('supervisor_daily_summary', { ...happyData, note: 'x'.repeat(201) })).toThrow(/PII_FIREWALL/);
  });
});

describe('number fidelity (rate-aware)', () => {
  const kpis = { attendanceRate: 0.84, units: 120, giftDistributionRate: 0.8 };

  it('allows ×100 form only for rate keys, not counts', () => {
    // 0.84 rate → 84 allowed; 120 count → 12000 NOT allowed.
    expect(allowedNumbers(kpis, {}).has('84')).toBe(true);
    expect(allowedNumbers(kpis, {}).has('12000')).toBe(false);
    expect(allowedNumbers(kpis, {}).has('120')).toBe(true);
  });

  it('rejects an invented numeral equal to 100× a count', () => {
    const output = { headline: 'We sold 12000 units.' };
    expect(checkNumbers(output, kpis).ok).toBe(false);
  });

  it('does not bless model-controlled array lengths', () => {
    const kpis2 = { attendanceRate: 0.5 };
    const output = { trends: ['a', 'b', 'c'], headline: '3 trends.' };
    expect(checkNumbers(output, kpis2).ok).toBe(false);
  });

  it('blesses the code-computed ranking length', () => {
    const kpis3 = { attendanceRate: 0.5 };
    const output = { ranking: ['A1', 'A2'], headline: '2 animateurs ranked.' };
    expect(checkNumbers(output, kpis3).ok).toBe(true);
  });
});

describe('pipeline dedupe and fallback', () => {
  const cap = getCapability('supervisor_daily_summary');
  const body = { ...fixture };

  function harness(opts = {}) {
    const calls = [];
    const delivered = [];
    const llm = createLlm({
      callModel: async ({ model }) => {
        calls.push(model);
        if (opts.throwOn?.includes(model)) throw new Error('provider down');
        return JSON.stringify(cap.fallback('en', cap.computeKpis(body.input.context.data), []));
      },
    });
    const callback = createCallback({
      key: 'k',
      fetchImpl: async () => { delivered.push(1); return { ok: true, status: 200 }; },
      sleep: async () => {},
    });
    return { pipeline: createPipeline({ llm, callback, outputMode: 'legacy' }), calls, delivered };
  }

  it('no-ops an in-flight duplicate requestId (one process, one callback)', async () => {
    const { pipeline, calls, delivered } = harness();
    // Gate the LLM so both enqueues overlap.
    let release;
    const gate = new Promise((r) => { release = r; });
    const llm = createLlm({
      callModel: async () => { await gate; return JSON.stringify(cap.fallback('en', cap.computeKpis(body.input.context.data), [])); },
    });
    const callback = createCallback({
      key: 'k',
      fetchImpl: async () => { delivered.push(1); return { ok: true, status: 200 }; },
      sleep: async () => {},
    });
    const p = createPipeline({ llm, callback, outputMode: 'legacy' });
    const a = p.enqueue(body, 'supervisor_daily_summary');
    const b = p.enqueue(body, 'supervisor_daily_summary');
    expect(b.duplicate).toBe(true);
    release();
    await Promise.all([a.promise, b.promise]);
    expect(delivered).toHaveLength(1);
  });

  it('retries a failed callback instead of caching it (enqueue re-runs process)', async () => {
    let calls = 0;
    const llm = createLlm({
      callModel: async () => JSON.stringify(cap.fallback('en', cap.computeKpis(body.input.context.data), [])),
    });
    const callback = createCallback({
      key: 'k',
      fetchImpl: async () => {
        calls += 1;
        return calls < 3 ? { ok: false, status: 500 } : { ok: true, status: 200 };
      },
      sleep: async () => {},
      backoffMs: [10],
    });
    const p = createPipeline({ llm, callback, outputMode: 'legacy' });
    // First enqueue: both callback attempts fail → callback_failed, NOT cached in `seen`.
    const r1 = p.enqueue(body, 'supervisor_daily_summary');
    const res1 = await r1.promise;
    expect(r1.duplicate).toBe(false);
    expect(res1.status).toBe('callback_failed');
    // Same requestId retries because the failed callback was not cached in `seen`.
    const r2 = p.enqueue(body, 'supervisor_daily_summary');
    const res2 = await r2.promise;
    expect(r2.duplicate).toBe(false);
    expect(res2.status).toBe('completed');
    // process ran for both enqueues (not deduped).
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});
