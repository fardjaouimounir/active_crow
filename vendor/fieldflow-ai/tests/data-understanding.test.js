import { describe, it, expect } from 'vitest';
import { SCENARIOS, buildRequest } from '../eval/scenarios.mjs';
import { refKpis, refDq } from '../eval/reference.mjs';
import { getCapability, computeCompleteness } from '../src/capabilities/index.js';
import { computeUnavailable, METRICS } from '../src/pipeline/kpis.js';
import { profileData, DQ_MEANING, DQ_SEVERITY } from '../src/pipeline/data-quality.js';
import { dataShapeIssues } from '../src/schemas/data.js';
import { OutputSchemas } from '../src/schemas/outputs.js';
import { checkNumbers } from '../src/pipeline/number-check.js';
import { checkLabels } from '../src/pipeline/label-check.js';
import { createPipeline } from '../src/pipeline/index.js';
import { createLlm } from '../src/pipeline/llm.js';

const ok = { post: async () => ({ ok: true, status: 200 }) };
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null));

describe('service agrees with the independent reference calculator on all 45 scenarios', () => {
  it('KPIs: same defined values; undefined metrics are omitted, never 0', () => {
    for (const s of SCENARIOS) {
      const got = getCapability(s.cap).computeKpis(s.data);
      const want = defined(refKpis(s.cap, s.data));
      expect(Object.keys(got).sort(), s.id).toEqual(Object.keys(want).sort());
      for (const [k, v] of Object.entries(want)) expect(got[k], `${s.id}.${k}`).toBeCloseTo(v, 3);
    }
  });

  it('data-quality findings equal the reference codes and severities', () => {
    for (const s of SCENARIOS) {
      expect(profileData(s.cap, s.data), s.id).toEqual(refDq(s.cap, s.data));
    }
  });

  it('unavailable metrics are exactly the ones missing from kpis', () => {
    for (const s of SCENARIOS) {
      const kpis = getCapability(s.cap).computeKpis(s.data);
      const all = METRICS[s.cap].map((m) => m.id);
      expect(computeUnavailable(s.cap, s.data).sort(), s.id).toEqual(all.filter((id) => !(id in kpis)).sort());
    }
  });
});

describe('undefined is not zero', () => {
  it('a missing target gives no attainment, gap or shortfall', () => {
    const k = getCapability('campaign_insights').computeKpis({ attendance: { present: 42, expected: 50 }, sales: { units: 120 }, gifts: { distributed: 80, planned: 100 } });
    for (const key of ['target', 'targetGap', 'targetAttainmentPct', 'targetShortfallPct']) expect(k).not.toHaveProperty(key);
    expect(k.units).toBe(120);
  });
  it('previous sales of 0 gives no percentage change; a zero denominator gives no rate', () => {
    const k = getCapability('supervisor_daily_summary').computeKpis({ attendance: { present: 0, expected: 0 }, sales: { units: 50, previousUnits: 0 }, gifts: { distributed: 5, planned: 10 } });
    expect(k).not.toHaveProperty('unitsDeltaPct');
    expect(k).not.toHaveProperty('attendanceRate');
    expect(k.missingCount).toBe(0);
  });
  it('an aggregate is undefined when any entity lacks the field', () => {
    const k = getCapability('sales_performance').computeKpis({ sellers: [{ label: 'S1', units: 100, target: 100 }, { label: 'S2', units: 80 }], periods: [] });
    expect(k.totalUnits).toBe(180);
    for (const key of ['totalTarget', 'targetGap', 'targetAttainmentPct']) expect(k).not.toHaveProperty(key);
  });
});

describe('completeness reflects missing per-row fields', () => {
  it('stays 1 for complete data and drops when a seller target is missing', () => {
    const full = { sellers: [{ label: 'S1', units: 100, target: 100 }, { label: 'S2', units: 80, target: 100 }], periods: [{ label: 'P1', units: 180 }] };
    expect(computeCompleteness('sales_performance', full)).toBe(1);
    const partial = structuredClone(full);
    delete partial.sellers[1].target;
    expect(computeCompleteness('sales_performance', partial)).toBeLessThan(1);
    expect(computeCompleteness('sales_performance', partial)).toBeGreaterThan(0.9);
    expect(computeCompleteness('sales_performance', {})).toBe(0);
    expect(computeCompleteness('animateur_coaching', { animateurs: [{ label: 'A1', units: 1 }] })).toBeLessThan(1);
  });
});

describe('typed data schemas are warn-only', () => {
  it('flags wrong types as NONNUMERIC and treats them as missing', () => {
    const data = { attendance: { present: true, expected: 50 }, sales: { units: 10, previousUnits: 5 }, gifts: { distributed: 1, planned: 2 } };
    expect(dataShapeIssues('supervisor_daily_summary', data)).toEqual(['attendance.present']);
    expect(profileData('supervisor_daily_summary', data).map((f) => f.code)).toEqual(expect.arrayContaining(['NONNUMERIC', 'FIELD_MISSING']));
    expect(getCapability('supervisor_daily_summary').computeKpis(data)).not.toHaveProperty('attendanceRate');
  });
  it('accepts null as missing and tolerates unknown keys', () => {
    expect(dataShapeIssues('campaign_insights', { sales: { units: 1, target: null }, extra: 'x' })).toEqual([]);
  });
});

describe('every finding code has a meaning in both languages and no digits', () => {
  it('is complete', () => {
    for (const code of Object.keys(DQ_SEVERITY)) {
      expect(DQ_MEANING[code]?.en, code).toBeTruthy();
      expect(DQ_MEANING[code]?.ar, code).toBeTruthy();
      expect(DQ_MEANING[code].en + DQ_MEANING[code].ar, code).not.toMatch(/\d/);
    }
  });
});

describe('deterministic fallback on all 45 scenarios (en and ar)', () => {
  it('is schema-valid, number-faithful, label-valid, states no undefined metric and reports the data issues', () => {
    for (const s of SCENARIOS) {
      const def = getCapability(s.cap);
      const kpis = def.computeKpis(s.data);
      const findings = profileData(s.cap, s.data);
      for (const locale of ['en', 'ar']) {
        const out = def.fallback(locale, kpis, def.computeRanking?.(s.data) ?? [], findings);
        const tag = `${s.id}/${locale}`;
        expect(OutputSchemas[s.cap].safeParse(out).success, tag).toBe(true);
        expect(checkNumbers(out, kpis, s.data).ok, tag).toBe(true);
        expect(checkLabels(out, s.data, kpis).ok, tag).toBe(true);
        if (findings.some((f) => f.severity !== 'info')) {
          expect(/verif|unavailable|تحقق|غير متاح/i.test(JSON.stringify(out)), tag).toBe(true);
        }
        if (findings.length > 0) expect(out.dataQuality, tag).toEqual(findings);
        else expect(out.dataQuality, tag).toBeUndefined();
      }
    }
  });

  it('never prints a zero for an undefined metric (missing campaign target)', () => {
    const s = SCENARIOS.find((x) => x.id === 'CAM-06');
    const def = getCapability(s.cap);
    const out = def.fallback('en', def.computeKpis(s.data), [], profileData(s.cap, s.data));
    expect(out.narrative).not.toMatch(/\b0\b|percent of target/);
    expect(out.narrative).toMatch(/unavailable/);
  });
});

describe('pipeline: findings reach the prompt and the output', () => {
  function run(id, locale, reply) {
    const s = SCENARIOS.find((x) => x.id === id);
    const prompts = [];
    const llm = createLlm({ callModel: async ({ user }) => { prompts.push(user); return { text: reply, model: 'm' }; } });
    const p = createPipeline({ llm, callback: ok, outputMode: 'legacy' });
    return p.process(buildRequest(s, locale, crypto.randomUUID()), s.cap).then((r) => ({ r, prompts }));
  }

  it('the user prompt lists code-detected findings and unavailable metrics', async () => {
    const { prompts } = await run('CAM-06', 'en', 'not json');
    expect(prompts[0]).toMatch(/DATA QUALITY \(code-detected, authoritative\):\n- TARGET_MISSING \(missing\)/);
    expect(prompts[0]).toMatch(/UNAVAILABLE METRICS .*targetGap.*targetAttainmentPct/);
  });

  it('clean data adds neither section', async () => {
    const { prompts } = await run('CAM-01', 'en', 'not json');
    expect(prompts[0]).not.toMatch(/DATA QUALITY|UNAVAILABLE METRICS/);
  });

  it('dataQuality in the output is code-set: a model-supplied value is overridden', async () => {
    const reply = JSON.stringify({
      locale: 'en', narrative: 'Sales reached 120 units; the target is missing so attainment is unavailable.', risks: [], opportunities: [], decisions: [],
      dataQuality: [{ code: 'MADE_UP', severity: 'info' }],
    });
    const { r } = await run('CAM-06', 'en', reply);
    expect(r.diagnostics.state).toBe('first_pass');
    expect(r.output.dataQuality).toEqual([{ code: 'TARGET_MISSING', severity: 'missing' }]);
    expect(r.output.kpis).not.toHaveProperty('targetAttainmentPct');
  });

  it('clean data: no dataQuality key even if the model adds one', async () => {
    const reply = JSON.stringify({ locale: 'en', narrative: 'Sales reached 150 units against a target of 150.', risks: [], opportunities: [], decisions: [], dataQuality: [{ code: 'X', severity: 'info' }] });
    const { r } = await run('CAM-01', 'en', reply);
    expect(r.diagnostics.state).toBe('first_pass');
    expect(r.output.dataQuality).toBeUndefined();
  });

  it('a fallback on conflicting data states the problem and carries the findings', async () => {
    const { r } = await run('SUP-07', 'ar', 'not json');
    expect(r.diagnostics.state).toBe('fallback');
    expect(r.output.dataQuality).toEqual([{ code: 'PRESENT_GT_EXPECTED', severity: 'conflict' }]);
    expect(r.output.attention[0].type).toBe('data_quality');
  });

  it('the system prompt carries the data-quality rules', async () => {
    const s = SCENARIOS[0];
    const { system } = getCapability(s.cap).buildPrompt({ locale: 'en', kpis: {}, data: {}, validationError: null });
    expect(system).toMatch(/DATA QUALITY:/);
    expect(system).toMatch(/must not be stated, estimated or written as 0/);
  });
});

describe('label check accepts references to what the model was shown', () => {
  const data = { attendance: { present: 42, expected: 50 }, sales: { units: 120 }, gifts: { distributed: 80, planned: 100 } };
  const out = (evidence) => ({ risks: [{ severity: 'medium', text: 'The target is unavailable.', evidence }] });
  it('finding codes, unavailable metric names and schema fields are valid evidence', () => {
    const kpis = getCapability('campaign_insights').computeKpis(data);
    expect(checkLabels(out(['TARGET_MISSING', 'targetGap', 'target', 'sales.target', 'giftGap']), data, kpis, 'campaign_insights').ok).toBe(true);
  });
  it('invented names and entity labels are still rejected', () => {
    const kpis = getCapability('campaign_insights').computeKpis(data);
    expect(checkLabels(out(['stock']), data, kpis, 'campaign_insights').ok).toBe(false);
    expect(checkLabels(out(['PDV-031']), data, kpis, 'campaign_insights').ok).toBe(false);
  });
  it('they are not accepted in label or ranking positions', () => {
    expect(checkLabels({ ranking: ['TARGET_MISSING'] }, data, {}, 'sales_performance').ok).toBe(false);
  });
});
