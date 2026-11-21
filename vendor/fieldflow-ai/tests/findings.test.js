import { describe, it, expect } from 'vitest';
import { SCENARIOS, buildRequest } from '../eval/scenarios.mjs';
import { refKpis, refRows } from '../eval/reference.mjs';
import { detectFindings, findingTopic, renderFinding, findingNumbers } from '../src/pipeline/findings.js';
import { validateClaims, renderReport, buildClaimsFallback } from '../src/pipeline/claims.js';
import { profileData } from '../src/pipeline/data-quality.js';
import { getCapability, PROMPT_VERSION } from '../src/capabilities/index.js';
import { OutputSchemas } from '../src/schemas/outputs.js';
import { checkNumbers } from '../src/pipeline/number-check.js';
import { checkLabels } from '../src/pipeline/label-check.js';
import { createPipeline } from '../src/pipeline/index.js';
import { createLlm } from '../src/pipeline/llm.js';

const sc = (id) => SCENARIOS.find((s) => s.id === id);
const find = (id) => { const s = sc(id); return detectFindings(s.cap, s.data, profileData(s.cap, s.data)); };
const types = (fs) => fs.map((f) => `${f.type}${f.entity ? `(${f.entity})` : ''}`);

describe('finding engine: priority against the hand-written oracle', () => {
  it('the top adverse finding is the scenario priority (14 scenarios)', () => {
    let checked = 0;
    for (const s of SCENARIOS.filter((x) => x.priority)) {
      const top = find(s.id).find((f) => f.polarity === 'adverse');
      expect(top && findingTopic(top), s.id).toBe(s.priority);
      checked += 1;
    }
    expect(checked).toBe(SCENARIOS.filter((x) => x.priority).length);
  });

  it('ranks data conflicts first, then adverse by relative gap, then positives', () => {
    const f = find('SAL-12'); // target 0 for S1 -> conflict
    expect(f[0].type).toBe('DATA_ISSUE');
    expect(f[0].severity).toBe('conflict');
    const order = find('SAL-11').filter((x) => x.type === 'TARGET_BELOW').map((x) => x.entity);
    expect(order.slice(0, 3)).toEqual(['S9', 'S11', 'S4']); // shortfalls 70%, 60%, 45%
    const fs = find('SUP-11');
    expect(fs.map((x) => x.polarity)).toEqual([...fs.map((x) => x.polarity)].sort((a, b) => ['adverse', 'positive', 'neutral'].indexOf(a) - ['adverse', 'positive', 'neutral'].indexOf(b)));
    fs.forEach((x, i) => expect(x.id).toBe(`F${i + 1}`));
  });
});

describe('finding engine: numbers agree with the independent reference', () => {
  it('entity target findings carry the reference gap and attainment', () => {
    let n = 0;
    for (const s of SCENARIOS.filter((x) => x.cap === 'sales_performance' || x.cap === 'animateur_coaching')) {
      const rows = refRows(s.cap, s.data).filter((r) => r.kind !== 'period');
      for (const f of find(s.id).filter((x) => x.type.startsWith('TARGET_'))) {
        const ref = rows.find((r) => r.label === f.entity);
        expect(f.values.gapToTarget, `${s.id} ${f.entity}`).toBeCloseTo(ref.gapToTarget, 3);
        expect(f.values.attainmentPct, `${s.id} ${f.entity}`).toBeCloseTo(ref.attainmentPct, 3);
        n += 1;
      }
    }
    expect(n).toBeGreaterThan(40);
  });

  it('group findings carry the reference KPI values', () => {
    const cam = find('CAM-03').find((f) => f.type === 'GIFTS_UNDISTRIBUTED');
    const k = refKpis('campaign_insights', sc('CAM-03').data);
    expect(cam.values.giftGap).toBe(k.giftGap);
    expect(cam.values.giftRemainingPct).toBe(k.giftRemainingPct);
    const sup = find('SUP-03').find((f) => f.type === 'SALES_DECLINE');
    expect(sup.values.unitsDeltaPct).toBe(refKpis('supervisor_daily_summary', sc('SUP-03').data).unitsDeltaPct);
  });
});

describe('finding engine: nothing is built on contradictory data', () => {
  it('present > expected: no attendance finding, a data issue instead', () => {
    const t = types(find('SUP-07'));
    expect(t.some((x) => x.startsWith('ATTENDANCE'))).toBe(false);
    expect(t).toContain('DATA_ISSUE');
  });
  it('distributed > planned: no gifts finding', () => {
    expect(types(find('CAM-07')).some((x) => x.startsWith('GIFTS'))).toBe(false);
  });
  it('duplicate labels: no per-entity finding at all', () => {
    expect(types(find('SAL-09')).filter((x) => x.includes('('))).toEqual(['PERIOD_INCREASE(P2)']);
    expect(types(find('ANI-07'))).toEqual(['DATA_ISSUE']);
  });
  it('zero target, negative units, mis-scaled rate: that entity gets no target finding', () => {
    expect(types(find('SAL-12'))).not.toContain('TARGET_BELOW(S1)');
    expect(types(find('SAL-12'))).not.toContain('TARGET_MET(S1)');
    expect(types(find('SAL-13')).filter((x) => x.includes('(S2)'))).toEqual([]);
    expect(types(find('ANI-05')).filter((x) => x.startsWith('HIGHEST_ATTENDANCE') || x.startsWith('LOWEST_ATTENDANCE'))).toEqual([]);
  });
  it('previous sales of 0 and expected 0 give no change / attendance finding', () => {
    expect(types(find('SUP-05')).some((x) => x.startsWith('SALES_'))).toBe(false);
    expect(types(find('SUP-09')).some((x) => x.startsWith('ATTENDANCE'))).toBe(false);
  });
  it('no extreme is declared when values tie', () => {
    expect(types(find('SAL-04')).filter((x) => x.startsWith('LOWEST_UNITS'))).toEqual([]);
    expect(types(find('ANI-10')).filter((x) => x.startsWith('LOWEST_ATTENDANCE'))).toEqual([]);
  });
});

describe('deterministic statements of findings (45 scenarios, en and ar)', () => {
  it('are number-faithful, label-valid and never contain undefined or NaN', () => {
    for (const s of SCENARIOS) {
      const fs = find(s.id);
      const kpis = getCapability(s.cap).computeKpis(s.data);
      for (const locale of ['en', 'ar']) {
        const out = { texts: fs.map((f) => renderFinding(f, locale)) };
        const tag = `${s.id}/${locale}`;
        expect(JSON.stringify(out), tag).not.toMatch(/undefined|NaN|null/);
        expect(checkNumbers(out, kpis, s.data, findingNumbers(fs)).ok, tag).toBe(true);
        expect(checkLabels({ trends: out.texts }, s.data, kpis, s.cap).ok, tag).toBe(true);
      }
    }
  });
});

describe('claims: structure and rendering', () => {
  const sal02 = sc('SAL-02');
  const fs02 = find('SAL-02'); // F1 = TARGET_BELOW(S2)
  const claim = (kind, ids, text) => ({ kind, findingIds: ids, text });

  it('rejects unknown finding ids and claims without a finding', () => {
    expect(validateClaims({ claims: [claim('observation', ['F99'], 'x')] }, fs02)).toMatchObject({ ok: false, code: 'UNKNOWN_FINDING' });
    expect(validateClaims({ claims: [claim('observation', [], 'x')] }, fs02)).toMatchObject({ ok: false, code: 'CLAIM_WITHOUT_FINDING' });
    expect(validateClaims({ claims: [claim('observation', ['F1'], 'x')] }, fs02)).toEqual({ ok: true });
  });

  it('a top adverse finding the model skipped is stated by code', () => {
    const out = renderReport('sales_performance', { claims: [claim('observation', ['F2'], 'Units rose in P2.')] }, fs02, 'en', sal02.data);
    expect(out.anomalies.join(' ')).toMatch(/S2 sold 45 units against a target of 100/);
    expect(out.insights.claims.find((c) => c.source === 'code').findingIds).toEqual(['F1']);
  });

  it('hypotheses are kept apart from facts and marked in insights', () => {
    const reply = { claims: [claim('observation', ['F1'], 'S2 sold 45 units against a target of 100.'), claim('hypothesis', ['F1'], 'S2 may have had less stock; worth verifying.')] };
    const out = renderReport('sales_performance', reply, fs02, 'en', sal02.data);
    expect(out.insights.claims.map((c) => c.kind)).toEqual(['observation', 'hypothesis']);
    expect(out.anomalies).toEqual(['S2 sold 45 units against a target of 100.', 'S2 may have had less stock; worth verifying.']);
  });

  it('coaching: claims go to the animateur they concern; group claims go to campaignActions', () => {
    const s = sc('ANI-02');
    const fs = find('ANI-02'); // A2 below target (F1), A1 above (F2)
    const reply = { claims: [
      claim('observation', ['F1'], 'A2 sold 95 units against a target of 100.'),
      claim('recommendation', ['F1'], 'Coach A2 on closing the gap.'),
      claim('observation', ['F2'], 'A1 sold 130 units against a target of 100.'),
      claim('recommendation', ['F1', 'F2'], 'Pair A2 with A1 for a field visit.'),
    ] };
    const out = renderReport('animateur_coaching', reply, fs, 'en', s.data);
    const a2 = out.coaching.find((c) => c.label === 'A2');
    const a1 = out.coaching.find((c) => c.label === 'A1');
    expect(a2.gaps[0]).toMatch(/A2 sold 95/);
    expect(a2.actions).toEqual(['Coach A2 on closing the gap.']);
    expect(a1.strengths[0]).toMatch(/A1 sold 130/);
    expect(out.campaignActions).toEqual(['Pair A2 with A1 for a field visit.']);
    expect(a2.evidenceRefs[0]).toBe('A2');
  });

  it('campaign risk severity is relative: first adverse finding high, data issues medium', () => {
    const s = sc('CAM-07');
    const fs = find('CAM-07'); // F1 data conflict, F2 sales shortfall
    const out = renderReport('campaign_insights', { headline: 'Sales are below target.', claims: [] }, fs, 'en', s.data);
    // F1 data conflict -> medium; F2 first adverse -> high; F3 attendance gap, second adverse -> medium
    expect(out.risks.map((r) => r.severity)).toEqual(['medium', 'high', 'medium']);
  });

  it('all four capabilities render schema-valid output for every scenario, with and without model claims', () => {
    for (const s of SCENARIOS) {
      const fs = find(s.id);
      const claims = fs.slice(0, 3).map((f) => claim('observation', [f.id], renderFinding(f, 'en')));
      for (const reply of [null, { headline: 'Overall.', claims }]) {
        const body = renderReport(s.cap, reply, fs, 'en', s.data, reply ? {} : { coverAll: true });
        const out = { locale: 'en', kpis: getCapability(s.cap).computeKpis(s.data), ...(s.cap === 'sales_performance' ? { ranking: [] } : {}), ...body };
        const r = OutputSchemas[s.cap].safeParse(out);
        expect(r.success, `${s.id} ${reply ? 'model' : 'code'} ${r.error?.message?.slice(0, 120)}`).toBe(true);
      }
    }
  });
});

describe('findings-based fallback on all 45 scenarios (en and ar)', () => {
  it('is schema-valid, number-faithful, label-valid and states the top finding and every data issue', () => {
    for (const s of SCENARIOS) {
      const def = getCapability(s.cap);
      const kpis = def.computeKpis(s.data);
      const dq = profileData(s.cap, s.data);
      const fs = detectFindings(s.cap, s.data, dq);
      for (const locale of ['en', 'ar']) {
        const out = buildClaimsFallback(s.cap, locale, kpis, def.computeRanking?.(s.data) ?? [], dq, fs, s.data);
        const tag = `${s.id}/${locale}`;
        expect(OutputSchemas[s.cap].safeParse(out).success, tag).toBe(true);
        expect(checkNumbers(out, kpis, s.data, findingNumbers(fs)).ok, tag).toBe(true);
        expect(checkLabels(out, s.data, kpis, s.cap).ok, tag).toBe(true);
        const text = JSON.stringify(out);
        if (fs[0]) expect(text.includes(JSON.stringify(renderFinding(fs[0], locale)).slice(1, -1)), `${tag} top finding`).toBe(true);
        expect(out.insights.findings).toHaveLength(fs.length);
      }
    }
  });
});

describe('pipeline in claims mode (stubbed model)', () => {
  const ok = { post: async () => ({ ok: true, status: 200 }) };
  function run(id, locale, replies) {
    const s = sc(id);
    const calls = [];
    const llm = createLlm({ callModel: async ({ user, system }) => { calls.push({ user, system }); return { text: replies[Math.min(calls.length - 1, replies.length - 1)], model: 'm' }; } });
    return createPipeline({ llm, callback: ok, outputMode: 'claims' })
      .process(buildRequest(s, locale, crypto.randomUUID()), s.cap).then((r) => ({ r, calls }));
  }
  const goodSales = JSON.stringify({ claims: [
    { kind: 'observation', findingIds: ['F1'], text: 'S2 sold 45 units against a target of 100.' },
    { kind: 'hypothesis', findingIds: ['F1'], text: 'S2 may have had less stock; worth verifying.' },
    { kind: 'recommendation', findingIds: ['F1'], text: 'Review S2 with the Superviseur.' },
  ], insights: { findings: [], claims: [] }, kpis: { totalUnits: 1 } });

  it('the prompt lists findings and asks for claims', async () => {
    const { calls } = await run('SAL-02', 'en', ['not json']);
    expect(calls[0].user).toMatch(/FINDINGS \(code-computed, ranked by priority, F1 first; cite these ids\):\n\{"id":"F1","type":"TARGET_BELOW","entity":"S2"/);
    expect(calls[0].system).toMatch(/"kind":"observation\|interpretation\|hypothesis\|recommendation"/);
  });

  it('accepts valid claims; kpis, ranking and insights are code-set (model values ignored)', async () => {
    const { r, calls } = await run('SAL-02', 'en', [goodSales]);
    expect(r.diagnostics.state).toBe('first_pass');
    expect(calls).toHaveLength(1);
    expect(r.output.kpis.totalUnits).toBe(360);
    expect(r.output.ranking).toEqual(['S1', 'S4', 'S3', 'S2']);
    expect(r.output.insights.findings[0]).toMatchObject({ id: 'F1', type: 'TARGET_BELOW', entity: 'S2' });
    expect(r.output.insights.claims.map((c) => c.kind)).toContain('hypothesis');
    expect(r.modelVersion).toMatch(new RegExp(`@${PROMPT_VERSION}$`));
  });

  it('unknown finding id -> one repair with a specific hint -> accepted', async () => {
    const bad = JSON.stringify({ claims: [{ kind: 'observation', findingIds: ['F77'], text: 'S2 trails.' }] });
    const { r, calls } = await run('SAL-02', 'en', [bad, goodSales]);
    expect(calls).toHaveLength(2);
    expect(calls[1].user).toMatch(/cited a finding id that does not exist/);
    expect(r.diagnostics.state).toBe('repaired');
  });

  it('a legacy-shaped reply is not accepted in claims mode: findings-based fallback', async () => {
    const legacy = JSON.stringify({ locale: 'en', ranking: [], trends: ['x'], anomalies: [], recommendedActions: [], kpis: {} });
    const { r } = await run('SAL-02', 'en', [legacy]);
    expect(r.diagnostics.state).toBe('fallback');
    expect(r.confidence).toBe(0);
    expect(r.output.anomalies.join(' ')).toMatch(/S2 sold 45 units against a target of 100/);
    expect(r.output.insights.claims.every((c) => c.source === 'code')).toBe(true);
  });

  it('an invented number in an observation is rejected by the claim rules and never reaches the report', async () => {
    const bad = JSON.stringify({ claims: [{ kind: 'observation', findingIds: ['F1'], text: 'S2 sold 77 units against a target of 100.' }] });
    const { r } = await run('SAL-02', 'en', [bad, bad]);
    expect(r.diagnostics.state).toBe('repaired');
    expect(JSON.stringify(r.output)).not.toMatch(/77/);
    expect(r.output.insights.rejected).toEqual([{ reason: 'UNGROUNDED_NUMBER', kind: 'observation' }]);
    expect(r.output.anomalies.join(' ')).toMatch(/S2 sold 45 units/); // code statement replaces it
  });

  it('the global numeric check still stops an invented number in a claim kind the rules do not scope', async () => {
    const bad = JSON.stringify({ claims: [{ kind: 'interpretation', findingIds: ['F1'], text: 'S2 will probably reach 77 units next month.' }] });
    const { r } = await run('SAL-02', 'en', [bad, bad]);
    expect(r.output.fallback.reasonCode).toBe('INVENTED_NUMERALS');
  });

  it('an invented label in a claim is rejected (claim rules) and never reaches the report', async () => {
    const bad = JSON.stringify({ claims: [{ kind: 'recommendation', findingIds: ['F1'], text: 'Visit PDV-031.' }] });
    const { r } = await run('SAL-02', 'en', [bad, bad]);
    expect(JSON.stringify(r.output)).not.toMatch(/PDV-031/);
    expect(r.output.insights.rejected[0].reason).toBe('UNGROUNDED_LABEL');
  });

  it('clean supervisor data without a headline still renders (headline from the top finding)', async () => {
    const reply = JSON.stringify({ claims: [{ kind: 'observation', findingIds: ['F1'], text: 'Attendance is 90 percent: 45 present out of 50 expected, 5 missing.' }] });
    const { r } = await run('SUP-01', 'en', [reply]);
    expect(r.diagnostics.state).toBe('first_pass');
    expect(r.output.summary.length).toBeGreaterThanOrEqual(3);
    expect(r.output.headline).toBeTruthy();
  });
});

describe('relative extremes are gaps, not strengths', () => {
  it('"lowest" findings lean weak without becoming adverse; coaching lists them under gaps', () => {
    const s = sc('ANI-02');
    const fs = find('ANI-02');
    const low = fs.find((f) => f.type === 'LOWEST_UNITS');
    expect(low).toMatchObject({ entity: 'A2', polarity: 'neutral', lean: 'weak' });
    expect(fs.find((f) => f.type === 'HIGHEST_UNITS').lean).toBeUndefined();
    const claim = (ids, text) => ({ kind: 'observation', findingIds: ids, text });
    const out = renderReport('animateur_coaching', { claims: [claim([low.id], 'A2 has the lowest units: 95.'), claim([fs.find((f) => f.type === 'HIGHEST_UNITS').id], 'A1 has the highest units: 130.')] }, fs, 'en', s.data);
    expect(out.coaching.find((c) => c.label === 'A2').gaps).toContain('A2 has the lowest units: 95.');
    expect(out.coaching.find((c) => c.label === 'A2').strengths).toEqual([]);
    expect(out.coaching.find((c) => c.label === 'A1').strengths).toContain('A1 has the highest units: 130.');
  });
});
