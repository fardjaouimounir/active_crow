import { describe, it, expect } from 'vitest';
import { SCENARIOS, buildRequest } from '../eval/scenarios.mjs';
import { HELDOUT } from '../eval/scenarios-heldout.mjs';
import { detectFindings, renderFinding, renderRecommendation } from '../src/pipeline/findings.js';
import { profileData } from '../src/pipeline/data-quality.js';
import { checkClaims } from '../src/pipeline/claim-rules.js';
import { getCapability } from '../src/capabilities/index.js';
import { createPipeline } from '../src/pipeline/index.js';
import { createLlm } from '../src/pipeline/llm.js';
import { OutputSchemas } from '../src/schemas/outputs.js';
import { checkLabels } from '../src/pipeline/label-check.js';
import { checkNumbers } from '../src/pipeline/number-check.js';

const ALL = [...SCENARIOS, ...HELDOUT];
const scenario = (id) => ALL.find((s) => s.id === id);
function ctx(id) {
  const s = scenario(id);
  const findings = detectFindings(s.cap, s.data, profileData(s.cap, s.data));
  return { s, findings, kpis: getCapability(s.cap).computeKpis(s.data), idOf: (t, e = null) => findings.find((f) => f.type === t && f.entity === e)?.id };
}
const claim = (kind, ids, text) => ({ kind, findingIds: ids, text });
const rules = (c, headline, claims = []) => checkClaims({ reply: { headline, claims }, findings: c.findings, capabilityId: c.s.cap, kpis: c.kpis, data: c.s.data });
const headlineVerdict = (c, h) => {
  const r = rules(c, h);
  return { kept: r.reply.headline !== undefined, reasons: r.violations.filter((v) => v.where === 'headline').map((v) => `${v.code}:${v.action}`) };
};

describe('D11: a headline follows the code priority', () => {
  const c = ctx('HLD-02'); // priority: gifts (67%), attendance (58%), sales (-40%)
  it('the finding order is the reference', () => {
    expect(c.findings.filter((f) => f.polarity === 'adverse').map((f) => f.type)).toEqual(['GIFTS_UNDISTRIBUTED', 'ATTENDANCE_GAP', 'SALES_DECLINE']);
  });

  it('a headline naming the topics in another order is dropped (en, ar, fr)', () => {
    for (const h of ['Attendance, sales and gift distribution are all below target.', 'الحضور والمبيعات وتوزيع الهدايا كلها دون المستوى.', 'La présence, les ventes et les cadeaux sont en retard.']) {
      expect(headlineVerdict(c, h), h).toEqual({ kept: false, reasons: ['HEADLINE_ORDER:drop'] });
    }
  });

  it('a headline in the code order is kept (en, ar, fr)', () => {
    for (const h of ['Gift distribution, attendance and sales are all below target.', 'توزيع الهدايا والحضور والمبيعات كلها دون المستوى.', 'Les cadeaux, la présence et les ventes sont en retard.']) {
      expect(headlineVerdict(c, h), h).toEqual({ kept: true, reasons: [] });
    }
  });

  it('only the TOP topic has to lead: the order of the lower ones is free', () => {
    expect(headlineVerdict(c, 'Gift distribution, sales and attendance are all below target.').kept).toBe(true);
    expect(headlineVerdict(c, 'Sales dropped while gift distribution and attendance fell short.').kept).toBe(false);
    const s3 = ctx('SUP-03'); // sales -29% leads, gifts 5% and attendance 4% are small
    expect(headlineVerdict(s3, 'Sales dropped by 29.167% while attendance and gift distribution remained high.').kept).toBe(true);
  });

  it('naming a lower-priority adverse topic while leaving out the top one is dropped; naming only the top is fine', () => {
    expect(headlineVerdict(c, 'Attendance is far below expectations.').kept).toBe(false);
    expect(headlineVerdict(c, 'Only 30 of 90 planned gifts were distributed.').kept).toBe(true);
    expect(headlineVerdict(c, 'Several indicators are behind plan.').kept).toBe(true);
  });

  it('is not applied when only one topic is adverse, and positive topics may come first', () => {
    const one = ctx('HLD-07'); // attendance is the only adverse topic; sales exceeded the target
    expect(headlineVerdict(one, 'Sales exceeded the target, but attendance is half of what was expected.').kept).toBe(true);
    expect(headlineVerdict(one, 'Attendance is half of expected; sales are above target.').kept).toBe(true);
  });

  it('the drop is not a rejection: it does not ask for a repair', () => {
    const r = rules(c, 'Attendance, sales and gift distribution are all below target.', [claim('observation', [c.idOf('GIFTS_UNDISTRIBUTED')], renderFinding(c.findings[0], 'en'))]);
    expect(r.violations.filter((v) => v.action === 'reject')).toEqual([]);
    expect(r.reply.claims).toHaveLength(1);
  });

  it('end to end: one model call, the code headline replaces the misordered one, and the drop is recorded', async () => {
    const s = scenario('HLD-02');
    const claims = c.findings.slice(0, 3).map((f) => claim('observation', [f.id], renderFinding(f, 'en')));
    const reply = JSON.stringify({ headline: 'Attendance, sales and gift distribution are all below target.', claims });
    const calls = [];
    const llm = createLlm({ callModel: async () => { calls.push(1); return { text: reply, model: 'm' }; } });
    const r = await createPipeline({ llm, callback: { post: async () => ({ ok: true }) }, outputMode: 'claims' }).process(buildRequest(s, 'en', crypto.randomUUID()), s.cap);
    expect(calls).toHaveLength(1);
    expect(r.diagnostics.state).toBe('first_pass');
    expect(r.output.headline).toBe(renderFinding(c.findings[0], 'en'));
    expect(r.output.insights.rejected).toEqual([{ reason: 'HEADLINE_ORDER', kind: 'headline' }]);
    expect(OutputSchemas.supervisor_daily_summary.safeParse(r.output).success).toBe(true);
  });
});

describe('D9: a report never loses all its actions because a recommendation was removed', () => {
  const ok = { post: async () => ({ ok: true }) };
  function run(id, locale, claims) {
    const s = scenario(id);
    const reply = JSON.stringify({ claims });
    const llm = createLlm({ callModel: async () => ({ text: reply, model: 'm' }) });
    return createPipeline({ llm, callback: ok, outputMode: 'claims' }).process(buildRequest(s, locale, crypto.randomUUID()), s.cap);
  }
  const causalRec = (id) => claim('recommendation', [id], 'Retrain the team because poor coaching caused the gap.');

  it('sales_performance: the removed recommendation is replaced by a neutral "review" action for the same finding', async () => {
    const c = ctx('SAL-02');
    const f = c.idOf('TARGET_BELOW', 'S2');
    const r = await run('SAL-02', 'en', [claim('observation', [f], 'S2 sold 45 units against a target of 100.'), causalRec(f)]);
    expect(r.output.recommendedActions).toEqual(['Review the performance of S2 against its target.']);
    expect(JSON.stringify(r.output)).not.toMatch(/caused|Retrain/);
    expect(r.output.insights.claims.find((x) => x.kind === 'recommendation')).toMatchObject({ source: 'code', findingIds: [f] });
    expect(r.output.insights.rejected).toEqual([{ reason: 'CAUSAL_NOT_HYPOTHESIS', kind: 'recommendation' }]);
  });

  it('supervisor, campaign and coaching (entity action) reports are restored too, in Arabic as well', async () => {
    const h = ctx('HLD-02');
    const sup = await run('HLD-02', 'en', [claim('observation', [h.idOf('GIFTS_UNDISTRIBUTED')], renderFinding(h.findings[0], 'en')), causalRec(h.idOf('GIFTS_UNDISTRIBUTED'))]);
    expect(sup.output.recommendedActions).toEqual(['Review the distribution of the remaining gifts.']);

    const k = ctx('CAM-09');
    const camp = await run('CAM-09', 'ar', [claim('observation', [k.idOf('SALES_TARGET_SHORTFALL')], renderFinding(k.findings.find((f) => f.type === 'SALES_TARGET_SHORTFALL'), 'ar')), causalRec(k.idOf('SALES_TARGET_SHORTFALL'))]);
    expect(camp.output.decisions).toEqual(['مراجعة فجوة المبيعات عن الهدف.']);

    const a = ctx('ANI-03');
    const f = a.idOf('TARGET_BELOW', 'A1');
    const coach = await run('ANI-03', 'en', [claim('observation', [f], renderFinding(a.findings.find((x) => x.id === f), 'en')), causalRec(f)]);
    expect(coach.output.coaching.find((x) => x.label === 'A1').actions).toEqual(['Review the performance of A1 against its target.']);
  });

  it('nothing is added when the model wrote no recommendation, or when another recommendation survives', async () => {
    const c = ctx('SAL-02');
    const f = c.idOf('TARGET_BELOW', 'S2');
    const none = await run('SAL-02', 'en', [claim('observation', [f], 'S2 sold 45 units against a target of 100.')]);
    expect(none.output.recommendedActions).toEqual([]);
    const kept = await run('SAL-02', 'en', [claim('observation', [f], 'S2 sold 45 units against a target of 100.'), claim('recommendation', [f], 'Review S2 with the Superviseur.'), causalRec(f)]);
    expect(kept.output.recommendedActions).toEqual(['Review S2 with the Superviseur.']);
    expect(kept.output.insights.claims.filter((x) => x.source === 'code' && x.kind === 'recommendation')).toEqual([]);
  });

  it('at most one action per finding and at most three in total', async () => {
    const c = ctx('SAL-11'); // S9, S11, S4, S8... below target
    const ids = ['S9', 'S11', 'S4', 'S8'].map((e) => c.idOf('TARGET_BELOW', e));
    const r = await run('SAL-11', 'en', [
      claim('observation', [ids[0]], renderFinding(c.findings.find((x) => x.id === ids[0]), 'en')),
      ...ids.map((id) => causalRec(id)), causalRec(ids[0]),
    ]);
    expect(r.output.recommendedActions).toHaveLength(3);
    expect(new Set(r.output.recommendedActions).size).toBe(3);
  });

  it('every neutral recommendation passes the label and number checks on all scenarios (en and ar)', () => {
    let n = 0;
    for (const s of ALL) {
      const findings = detectFindings(s.cap, s.data, profileData(s.cap, s.data));
      const kpis = getCapability(s.cap).computeKpis(s.data);
      for (const f of findings.filter((x) => x.polarity === 'adverse' || x.polarity === 'data')) {
        for (const locale of ['en', 'ar']) {
          const text = renderRecommendation(f, locale);
          expect(text, `${s.id} ${f.type}`).toBeTruthy();
          expect(text.replace(/(?<![A-Za-z0-9])[A-Z]{1,4}[-_]?\d+(?![A-Za-z0-9])/g, ''), 'no figure besides the entity label').not.toMatch(/\d/);
          expect(checkLabels({ recommendedActions: [text] }, s.data, kpis, s.cap).ok, `${s.id} ${f.type} ${locale}`).toBe(true);
          expect(checkNumbers({ recommendedActions: [text] }, kpis, s.data, []).ok).toBe(true);
          n += 1;
        }
      }
    }
    expect(n).toBeGreaterThan(200);
    expect(renderRecommendation({ type: 'KNOWN_CAUSE', code: 'STK-01' }, 'en')).toBeNull();
  });
});
