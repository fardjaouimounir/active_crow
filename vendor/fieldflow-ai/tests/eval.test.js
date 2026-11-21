import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { SCENARIOS, buildRequest } from '../eval/scenarios.mjs';
import { refKpis, refDq } from '../eval/reference.mjs';
import { judge } from '../eval/judge.mjs';
import { RequestSchema } from '../src/schemas/request.js';
import { prepareReportData } from '../src/capabilities/index.js';

const byId = (id) => SCENARIOS.find((s) => s.id === id);
const codes = (v) => v.critical.map((c) => c.code);

describe('benchmark scenarios', () => {
  it('has 45 unique scenarios across the four capabilities', () => {
    expect(SCENARIOS).toHaveLength(45);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(45);
    const count = (cap) => SCENARIOS.filter((s) => s.cap === cap).length;
    expect([count('supervisor_daily_summary'), count('sales_performance'), count('campaign_insights'), count('animateur_coaching')]).toEqual([11, 13, 10, 11]);
  });

  it('every scenario is a valid request in both locales and passes the PII firewall', () => {
    for (const s of SCENARIOS) {
      for (const locale of ['en', 'ar']) {
        const req = buildRequest(s, locale, '00000000-0000-4000-8000-000000000001');
        expect(RequestSchema.safeParse(req).success, `${s.id}/${locale}`).toBe(true);
        expect(() => prepareReportData(s.cap, req.input.context.data), s.id).not.toThrow();
      }
    }
  });

  it('hand-written data-quality codes equal the reference calculator', () => {
    for (const s of SCENARIOS) {
      expect(refDq(s.cap, s.data).map((d) => d.code), s.id).toEqual([...s.dq].sort());
    }
  });

  it('every scenario declares only known tags and focus items', () => {
    for (const s of SCENARIOS) {
      for (const f of s.focus) expect(/^(attendance|gifts|sales|target|visits|trend)$|^[A-Z]+\d+$/.test(f), `${s.id} ${f}`).toBe(true);
      if (s.priority) expect(s.focus).toContain(s.priority);
    }
  });
});

describe('reference calculator', () => {
  it('matches the values worked out by hand (null = undefined, never 0)', () => {
    let checked = 0;
    for (const s of SCENARIOS.filter((x) => x.hand)) {
      const k = refKpis(s.cap, s.data);
      for (const [key, want] of Object.entries(s.hand)) {
        if (want === null) expect(k[key], `${s.id}.${key}`).toBeNull();
        else expect(k[key], `${s.id}.${key}`).toBeCloseTo(want, 3);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(70);
  });

  it('is independent of the service code', () => {
    for (const f of ['reference.mjs', 'scenarios.mjs']) {
      const src = fs.readFileSync(new URL(`../eval/${f}`, import.meta.url), 'utf8');
      expect(src).not.toMatch(/from\s+['"][^'"]*src\//);
    }
  });
});

// ---- the judge itself must catch known-bad reports and accept good ones ----
const kpisFor = (s) => Object.fromEntries(Object.entries(refKpis(s.cap, s.data)).filter(([, v]) => v !== null));
const sal03 = byId('SAL-03');
const sales = (over, locale = 'en') => ({
  locale, ranking: ['S1', 'S2'], trends: [], anomalies: [], recommendedActions: [], kpis: kpisFor(sal03), ...over,
});
const goodEn = sales({
  trends: ['S1 sold 101 units against a target of 100.', 'S2 sold 99 units against a target of 100.'],
  anomalies: ['S2 is 1 unit below its target of 100.'],
  recommendedActions: ['Review the S2 pipeline with the Superviseur.'],
});
const run = (scenario, locale, output) => judge({ scenario, locale, output, diagnostics: { state: 'first_pass' } });

describe('judge: accepts correct reports', () => {
  it('English', () => {
    const v = run(sal03, 'en', goodEn);
    expect(codes(v)).toEqual([]);
    expect(v.passed).toBe(true);
  });
  it('Arabic with Arabic-Indic digits', () => {
    const v = run(sal03, 'ar', sales({
      locale: 'ar',
      trends: ['حقق S1 ١٠١ وحدة مقابل هدف ١٠٠.', 'حقق S2 ٩٩ وحدة مقابل هدف ١٠٠.'],
      anomalies: ['S2 أقل من هدفه بوحدة واحدة.'],
      recommendedActions: ['راجع أداء S2 مع Superviseur.'],
    }));
    expect(codes(v)).toEqual([]);
  });
  it('a negated direction word is not a contradiction', () => {
    expect(codes(run(sal03, 'en', sales({ anomalies: ['S2 did not exceed its target of 100.'] })))).toEqual([]);
  });
  it('a hedged cause is allowed', () => {
    expect(codes(run(sal03, 'en', sales({ anomalies: ['S2 may be affected by stock availability; verify with the Superviseur.'] })))).toEqual([]);
  });
});

describe('judge: false positives found while validating the baseline stay fixed', () => {
  it('"إجراءات" (actions) is not a causal marker', () => {
    expect(codes(run(sal03, 'ar', sales({ locale: 'ar', recommendedActions: ['مراجعة أداء S2 واتخاذ الإجراءات التصحيحية.'] })))).toEqual([]);
  });
  it('a recommendation about growth is not a claim that sales grew', () => {
    const s = byId('SUP-03');
    const out = { locale: 'en', headline: 'Sales fell.', summary: ['Sales fell to 85 from 120.', 'Attendance reached 96 percent.', 'Gift distribution is 95 percent.'], attention: [], recommendedActions: ['Review the offer to increase sales.'], kpis: kpisFor(s) };
    expect(codes(run(s, 'en', out))).toEqual([]);
  });
  it('"best practices" is not a superlative', () => {
    expect(codes(run(sal03, 'en', sales({ recommendedActions: ['Share best practices with S2.'], anomalies: ['Share best practices with S2.'] })))).toEqual([]);
  });
  it('a range across several entities in one clause is not a misattribution', () => {
    const s = byId('SAL-02'); // periods 100, 120, 140
    const out = { locale: 'en', ranking: ['S1', 'S4', 'S3', 'S2'], trends: ['Units grew from 100 in P1 to 140 in P3.'], anomalies: [], recommendedActions: [], kpis: kpisFor(s) };
    expect(codes(run(s, 'en', out))).toEqual([]);
  });
  it('ranking is not judged when labels are duplicated', () => {
    const s = byId('SAL-09');
    const out = { locale: 'en', ranking: ['S1', 'S2', 'S1'], trends: ['Data contains a duplicate label and must be verified.'], anomalies: [], recommendedActions: [], kpis: kpisFor(s) };
    expect(codes(run(s, 'en', out))).not.toContain('WRONG_RANKING');
  });
});

describe('judge: critical gates', () => {
  const cases = [
    ['swapped sellers', 'WRONG_ATTRIBUTION', sales({ trends: ['S2 sold 101 units against a target of 100.'] })],
    ['reversed direction (en)', 'WRONG_DIRECTION', sales({ anomalies: ['S1 missed its target of 100 by 1 unit.'] })],
    ['reversed direction (ar)', 'WRONG_DIRECTION', sales({ locale: 'ar', anomalies: ['تجاوز S2 هدفه.'] })],
    ['unknown seller', 'UNKNOWN_LABEL', sales({ trends: ['S9 sold 99 units.'] })],
    ['unknown reference', 'UNKNOWN_LABEL', sales({ anomalies: ['S2 trails.'], recommendedActions: ['Visit PDV-031.'] })],
    ['invented number', 'UNSUPPORTED_NUMBER', sales({ trends: ['Sales fell 37 percent.'] })],
    ['cause stated as fact', 'CAUSAL_AS_FACT', sales({ anomalies: ['S2 underperformed because of stock-outs.'] })],
    ['wrong superlative', 'WRONG_SUPERLATIVE', sales({ trends: ['S2 is the top seller.'] })],
    ['wrong ranking', 'WRONG_RANKING', sales({ ranking: ['S2', 'S1'] })],
    ['PII', 'PII_LEAK', sales({ trends: ['Contact a.b@example.com about S2.'] })],
    ['wrong KPI', 'KPI_WRONG_VALUE', sales({ kpis: { ...kpisFor(sal03), totalUnits: 250 } })],
  ];
  for (const [name, code, output] of cases) {
    it(`${name} -> ${code}`, () => {
      const v = run(sal03, output.locale, output);
      expect(codes(v)).toContain(code);
      expect(v.passed).toBe(false);
    });
  }

  it('schema-invalid output', () => {
    expect(codes(run(sal03, 'en', { locale: 'en', ranking: 'oops', kpis: {} }))).toContain('SCHEMA_INVALID');
  });

  it('undefined metric reported as a value (missing target stated as 0)', () => {
    const s = byId('CAM-06');
    const out = { locale: 'en', narrative: 'The campaign delivered 120 units.', risks: [], opportunities: [], decisions: [], kpis: { ...kpisFor(s), target: 0, targetGap: -120 } };
    expect(codes(run(s, 'en', out))).toContain('KPI_UNDEFINED_AS_VALUE');
    expect(codes(run(s, 'en', { ...out, kpis: kpisFor(s) }))).toEqual([]);
  });

  it('impossible data narrated as normal fails; acknowledging it passes', () => {
    const s = byId('SUP-07');
    const mk = (text) => ({ locale: 'en', headline: 'Attendance reached 120 percent.', summary: [text, 'Units reached 120 versus 100 previously.', 'Gift distribution is 80 percent.'], attention: [], recommendedActions: [], kpis: kpisFor(s) });
    expect(codes(run(s, 'en', mk('Attendance is 120 percent of the 50 expected.')))).toContain('DATA_CONFLICT_IGNORED');
    expect(codes(run(s, 'en', mk('Present (60) exceeds the 50 expected, so the attendance data is inconsistent and must be verified.')))).not.toContain('DATA_CONFLICT_IGNORED');
  });

  it('sales direction wrong at supervisor level', () => {
    const s = byId('SUP-03');
    const out = { locale: 'en', headline: 'Sales rose.', summary: ['Sales rose versus the previous day.', 'Attendance reached 96 percent.', 'Gift distribution is 95 percent.'], attention: [], recommendedActions: [], kpis: kpisFor(s) };
    expect(codes(run(s, 'en', out))).toContain('WRONG_DIRECTION');
  });

  it('error outputs are reported as no_output, not judged', () => {
    expect(run(sal03, 'en', { error: { code: 'NEEDS_DATA', message: 'x' } }).status).toBe('no_output');
  });
});

describe('recorded baseline replay', () => {
  const file = new URL('../eval/recorded/baseline.json', import.meta.url);
  it.skipIf(!fs.existsSync(file))('judges every recorded case without error and is deterministic', async () => {
    const { records } = JSON.parse(fs.readFileSync(file, 'utf8'));
    const { summarise } = await import('../eval/run.mjs');
    const a = summarise(records);
    const b = summarise(records);
    expect(a.total).toBe(records.length);
    expect(a).toEqual(b);
  });
});

describe('judge: causal check scope (found while validating the P2 run)', () => {
  const cam = byId('CAM-08');
  const camOut = (over) => ({ locale: 'en', narrative: 'Sales reached 100 units against a target of 150.', risks: [], opportunities: [], decisions: [], kpis: kpisFor(cam), ...over });
  it('explaining why a metric is unavailable is not a business-cause claim', () => {
    expect(codes(run(cam, 'en', camOut({ risks: [{ severity: 'medium', text: 'Attendance rate is unavailable because expected attendance is zero.', evidence: ['TARGET_MISSING'] }] })))).not.toContain('CAUSAL_AS_FACT');
  });
  it('"determine the cause" in a recommendation is not a claim', () => {
    expect(codes(run(sal03, 'ar', sales({ locale: 'ar', recommendedActions: ['مراجعة أداء S2 لتحديد السبب وراء التباين.'] })))).not.toContain('CAUSAL_AS_FACT');
  });
  it('a business cause stated as fact in an observation is still caught', () => {
    expect(codes(run(cam, 'en', camOut({ narrative: 'Sales are low because of weak promotion.' })))).toContain('CAUSAL_AS_FACT');
  });
});

describe('judge: Arabic "دون" is not always "below"', () => {
  it('"without any gap" is not a below-target claim', () => {
    const out = sales({ locale: 'ar', anomalies: ['حقق S1 هدفه بالكامل دون أي فجوة.'] });
    expect(codes(run(sal03, 'ar', out))).not.toContain('WRONG_DIRECTION');
  });
  it('"below the target" is still caught when the entity is above', () => {
    expect(codes(run(sal03, 'ar', sales({ locale: 'ar', anomalies: ['حقق S1 أداءً دون الهدف.'] })))).toContain('WRONG_DIRECTION');
  });
});

describe('judge: Arabic negation (JavaScript \b never matched Arabic letters)', () => {
  it('"not enough to exceed the target" is not a claim that the target was exceeded', () => {
    const out = sales({ locale: 'ar', anomalies: ['لم تكن نسبة حضور S2 كافية لتجاوز هدفه.'] });
    expect(codes(run(sal03, 'ar', out))).not.toContain('WRONG_DIRECTION');
    expect(codes(run(sal03, 'ar', sales({ locale: 'ar', anomalies: ['تجاوز S2 هدفه.'] })))).toContain('WRONG_DIRECTION');
  });
});
