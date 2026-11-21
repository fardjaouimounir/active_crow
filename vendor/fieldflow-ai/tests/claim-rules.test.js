import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { SCENARIOS, buildRequest } from '../eval/scenarios.mjs';
import { detectFindings, renderFinding } from '../src/pipeline/findings.js';
import { profileData } from '../src/pipeline/data-quality.js';
import { checkClaims } from '../src/pipeline/claim-rules.js';
import { getCapability } from '../src/capabilities/index.js';
import { createPipeline } from '../src/pipeline/index.js';
import { createLlm } from '../src/pipeline/llm.js';
import { OutputSchemas } from '../src/schemas/outputs.js';

const scenario = (id) => SCENARIOS.find((s) => s.id === id);

// Build the finding list for a scenario (optionally with explicit causes added to the data).
function ctx(id, extraData = {}) {
  const s = scenario(id);
  const data = { ...structuredClone(s.data), ...extraData };
  const fs_ = detectFindings(s.cap, data, profileData(s.cap, data));
  const kpis = getCapability(s.cap).computeKpis(data);
  const idOf = (type, entity = null) => fs_.find((f) => f.type === type && f.entity === entity)?.id;
  return { s, data, findings: fs_, kpis, idOf };
}
const claim = (kind, ids, text) => ({ kind, findingIds: ids, text });
function check(c, claims, headline) {
  return checkClaims({ reply: { ...(headline ? { headline } : {}), claims }, findings: c.findings, capabilityId: c.s.cap, kpis: c.kpis, data: c.data });
}
const codesOf = (r) => r.violations.filter((v) => v.action === 'reject').map((v) => v.code);
const kept = (r) => r.reply.claims.map((c) => c.kind);

describe('CAM-09 (Arabic): the recorded P3 reply is reproduced and neutralised', () => {
  // Texts copied verbatim from the recorded live run (eval/recorded/p3.json, CAM-09 ar run 1).
  const HEADLINE = 'تراجع أداء الحملة بسبب نقص توزيع الهدايا وعدم تحقيق أهداف المبيعات مع وجود فجوة في الحضور.';
  const RECORDED = (c) => [
    claim('observation', [c.idOf('GIFTS_UNDISTRIBUTED')], 'تم توزيع 30 هدية فقط من أصل 100 مخططة، مما يترك فجوة قدرها 70 هدية (70%).'),
    claim('interpretation', [c.idOf('GIFTS_UNDISTRIBUTED')], 'يعكس هذا النقص الكبير في توزيع الهدايا خللاً في آلية التنفيذ أو التوزيع على الأرض.'),
    claim('hypothesis', [c.idOf('GIFTS_UNDISTRIBUTED'), c.idOf('SALES_TARGET_SHORTFALL')], 'قد يكون تأخر توزيع الهدايا سبباً محتملاً لانخفاض المبيعات، مما يستحق التحقق منه.'),
    claim('recommendation', [c.idOf('GIFTS_UNDISTRIBUTED')], 'يجب على فريق الإشراف مراجعة آلية توزيع الهدايا لضمان استكمال الكمية المخططة.'),
    claim('observation', [c.idOf('SALES_TARGET_SHORTFALL')], 'بلغت المبيعات 60 وحدة مقابل هدف 150 وحدة، مما يعني تحقيق 40% من الهدف وفجوة قدرها 90 وحدة (60%).'),
    claim('interpretation', [c.idOf('SALES_TARGET_SHORTFALL')], 'يشير هذا التراجع الحاد في المبيعات إلى ضعف في تحويل الزيارات إلى مبيعات فعلية.'),
    claim('recommendation', [c.idOf('ATTENDANCE_GAP')], 'يوصى بمتابعة أسباب غياب 5 أشخاص لضمان اكتمال فريق العمل في Point de Vente.'),
    claim('observation', [c.idOf('ATTENDANCE_GAP')], 'حضر 45 شخصاً من أصل 50 متوقعاً، مما يمثل فجوة حضور قدرها 5 أشخاص ومعدل حضور 90%.'),
  ];

  it('the causal headline is rejected, as are the diagnostic interpretations and the invented role', () => {
    const c = ctx('CAM-09');
    const r = check(c, RECORDED(c), HEADLINE);
    const byWhere = (w) => r.violations.filter((v) => v.where === w && v.action === 'reject').map((v) => v.code);
    expect(r.reply.headline).toBeUndefined();
    expect(byWhere('headline')).toContain('CAUSAL_NOT_HYPOTHESIS');
    expect(byWhere('claim 2')).toContain('CAUSAL_NOT_HYPOTHESIS'); // "reflects a defect in execution"
    expect(byWhere('claim 6')).toEqual(expect.arrayContaining(['CAUSAL_NOT_HYPOTHESIS', 'UNDEFINED_METRIC'])); // "weakness in converting visits"
    expect(byWhere('claim 7')).toContain('UNDEFINED_TERM'); // "فريق العمل"
  });

  it('the legitimate observations and the hedged hypothesis survive', () => {
    const c = ctx('CAM-09');
    const r = check(c, RECORDED(c), HEADLINE);
    const survivors = r.reply.claims.map((cl) => cl.text);
    expect(survivors).toContain('قد يكون تأخر توزيع الهدايا سبباً محتملاً لانخفاض المبيعات، مما يستحق التحقق منه.');
    expect(survivors.filter((t) => t.startsWith('تم توزيع 30') || t.startsWith('بلغت المبيعات 60') || t.startsWith('حضر 45')).length).toBe(3);
    expect(kept(r).filter((k) => k === 'hypothesis')).toHaveLength(1);
  });

  it('end to end: the same reply never puts the unsupported cause in the report', async () => {
    const s = scenario('CAM-09');
    const c = ctx('CAM-09');
    const reply = JSON.stringify({ headline: HEADLINE, claims: RECORDED(c).map(({ kind, findingIds, text }) => ({ kind, findingIds, text })) });
    const llm = createLlm({ callModel: async () => ({ text: reply, model: 'm' }) });
    const r = await createPipeline({ llm, callback: { post: async () => ({ ok: true }) }, outputMode: 'claims' })
      .process(buildRequest(s, 'ar', crypto.randomUUID()), s.cap);
    const text = JSON.stringify(r.output);
    expect(r.diagnostics.state).toBe('repaired'); // one repair, then safe rejection
    expect(text).not.toMatch(/بسبب نقص توزيع|خللاً|ضعف في تحويل|فريق العمل/);
    expect(r.output.narrative).not.toMatch(/بسبب/);
    expect(r.output.insights.rejected.map((x) => x.reason)).toEqual(expect.arrayContaining(['CAUSAL_NOT_HYPOTHESIS', 'UNDEFINED_METRIC', 'UNDEFINED_TERM']));
    expect(OutputSchemas.campaign_insights.safeParse(r.output).success).toBe(true);
  });

  it.skipIf(!fs.existsSync(new URL('../eval/recorded/p3.json', import.meta.url)))('the recorded live run is flagged by the validator (both runs)', () => {
    const { records } = JSON.parse(fs.readFileSync(new URL('../eval/recorded/p3.json', import.meta.url), 'utf8'));
    const hits = records.filter((r) => r.id === 'CAM-09' && r.locale === 'ar' && /بسبب نقص توزيع الهدايا/.test(r.output.narrative ?? ''));
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      const c = ctx('CAM-09');
      const out = checkClaims({ reply: { headline: h.output.narrative.split('. ')[0], claims: [] }, findings: c.findings, capabilityId: 'campaign_insights', kpis: c.kpis, data: c.data });
      expect(out.reply.headline).toBeUndefined();
    }
  });
});

describe('causality: a cause is a hypothesis unless the data states it', () => {
  const c = ctx('SAL-02'); // F: TARGET_BELOW(S2)
  const f2 = c.idOf('TARGET_BELOW', 'S2');
  const cases = [
    ['en: cause as fact', 'observation', 'S2 is below target because of weak promotion.'],
    ['en: correlation read as causation', 'interpretation', 'Sales fell and attendance fell, so low attendance caused the decline in S2.'],
    ['en: diagnosis without a connector', 'interpretation', 'S2 shows a weakness in field execution.'],
    ['en: led to', 'observation', 'S2 missing its target led to weak customer engagement in the area.'],
    ['ar: cause as fact', 'observation', 'انخفض أداء S2 بسبب ضعف التسويق.'],
    ['ar: with diacritics', 'observation', 'انخفض أداء S2 بِسَبَبِ التسويق.'],
    ['ar: diagnosis', 'interpretation', 'يعكس أداء S2 خللاً في التنفيذ.'],
    ['fr: cause as fact', 'observation', "S2 est sous l'objectif à cause d'un manque de formation."],
    ['fr: caused by', 'interpretation', 'Le retard de S2 est causé par la saisonnalité.'],
  ];
  for (const [name, kind, text] of cases) {
    it(`${name} is rejected`, () => {
      expect(codesOf(check(c, [claim(kind, [f2], text)]))).toContain('CAUSAL_NOT_HYPOTHESIS');
    });
  }

  it('a hedged cause stated as another kind is downgraded to a hypothesis, not accepted as fact', () => {
    for (const text of ['S2 is below target, possibly because of weak promotion.', 'قد يكون أداء S2 منخفضاً بسبب التسويق.', 'S2 pourrait être sous son objectif en raison de la saisonnalité.']) {
      const r = check(c, [claim('observation', [f2], text)]);
      expect(codesOf(r), text).not.toContain('CAUSAL_NOT_HYPOTHESIS');
      expect(r.reply.claims[0]).toMatchObject({ kind: 'hypothesis', downgradedFrom: 'observation' });
    }
  });

  it('a hypothesis must itself be hedged (en, ar, fr)', () => {
    for (const text of ['S2 is below target because stock ran out.', 'أداء S2 منخفض لأن المخزون نفد.', 'S2 est sous son objectif car le stock est épuisé.']) {
      expect(codesOf(check(c, [claim('hypothesis', [f2], text)])), text).toContain('HYPOTHESIS_NOT_HEDGED');
    }
    for (const text of ['S2 may have had less availability; worth verifying.', 'قد يكون لدى S2 ظروف خاصة تستحق التحقق.', 'S2 a peut-être eu moins de visites; à vérifier.']) {
      expect(codesOf(check(c, [claim('hypothesis', [f2], text)])), text).toEqual([]);
    }
  });

  it('an arithmetic consequence ("... which led to a gap of 55") is not a business cause (en, ar, fr)', () => {
    for (const text of ['S2 sold 45 units against a target of 100, which led to a gap of 55 units.', 'سجل S2 مبيعات قدرها 45 وحدة مقابل هدف 100، مما أدى إلى فجوة سلبية قدرها 55 وحدة.', "S2 a vendu 45 unités pour un objectif de 100, ce qui a entraîné un écart de 55 unités."]) {
      expect(codesOf(check(c, [claim('observation', [f2], text)])), text).not.toContain('CAUSAL_NOT_HYPOTHESIS');
    }
    expect(codesOf(check(c, [claim('observation', [f2], 'S2 sold 45 units, which led to lower morale.')]))).toContain('CAUSAL_NOT_HYPOTHESIS');
  });

  it('plain arithmetic about the gap is not a cause', () => {
    for (const text of ['S2 is 55 units below its target of 100.', 'S2 a vendu 45 unités pour un objectif de 100.', 'S2 أقل من هدفه بـ 55 وحدة.']) {
      expect(codesOf(check(c, [claim('interpretation', [f2], text)])), text).toEqual([]);
    }
  });

  it('a recommendation that asserts a cause is rejected, a hedged one is kept', () => {
    expect(codesOf(check(c, [claim('recommendation', [f2], 'Review S2 because poor coaching caused the gap.')]))).toContain('CAUSAL_NOT_HYPOTHESIS');
    expect(codesOf(check(c, [claim('recommendation', [f2], 'Review S2, which may be affected by availability.')]))).toEqual([]);
  });
});

describe('explicit evidence: a cause may be stated as fact only when the data states it', () => {
  const withCause = ctx('SAL-02', { causes: [{ label: 'S2', code: 'STK-01' }] });
  const f1 = withCause.idOf('TARGET_BELOW', 'S2');
  const fc = withCause.idOf('KNOWN_CAUSE', 'S2');
  const text = 'S2 is below target because of cause STK-01, reported in the data.';

  it('the cause becomes a finding with an opaque code', () => {
    expect(fc).toBeTruthy();
    const f = withCause.findings.find((x) => x.id === fc);
    expect(f).toMatchObject({ type: 'KNOWN_CAUSE', polarity: 'cause', entity: 'S2', code: 'STK-01' });
    expect(renderFinding(f, 'en')).toBe('The data reports cause code STK-01 for S2.');
    expect(renderFinding(f, 'ar')).toMatch(/STK-01/);
  });

  it('citing the KNOWN_CAUSE finding lets the claim state the cause as fact', () => {
    const r = check(withCause, [claim('observation', [f1, fc], text)]);
    expect(codesOf(r)).toEqual([]);
    expect(r.reply.claims[0].kind).toBe('observation');
  });

  it('the same sentence without citing it is rejected', () => {
    expect(codesOf(check(withCause, [claim('observation', [f1], text)]))).toContain('UNGROUNDED_LABEL'); // STK-01 not in the cited findings
    expect(codesOf(check(withCause, [claim('observation', [f1], 'S2 is below target because of weak promotion.')]))).toContain('CAUSAL_NOT_HYPOTHESIS');
  });

  it('a cause attached to another entity does not justify the claim', () => {
    const other = ctx('SAL-02', { causes: [{ label: 'S1', code: 'STK-01' }] });
    const r = check(other, [claim('observation', [other.idOf('TARGET_BELOW', 'S2'), other.idOf('KNOWN_CAUSE', 'S1')], 'S2 is below target because of cause STK-01.')]);
    expect(codesOf(r)).toContain('CAUSAL_NOT_HYPOTHESIS'); // the cause belongs to S1, the claim is about S2
  });

  it('causes for unknown labels are ignored, and no cause finding exists without data.causes', () => {
    expect(ctx('SAL-02', { causes: [{ label: 'ZZ9', code: 'X-1' }] }).findings.some((f) => f.type === 'KNOWN_CAUSE')).toBe(false);
    expect(ctx('SAL-02').findings.some((f) => f.type === 'KNOWN_CAUSE')).toBe(false);
  });

  it('a hypothesis about a known cause needs no hedge', () => {
    expect(codesOf(check(withCause, [claim('hypothesis', [f1, fc], 'Cause STK-01 explains the S2 gap.')]))).toEqual([]);
  });

  it('data limitations may be explained causally (the mechanism is known to the code)', () => {
    const k = ctx('CAM-08'); // expected attendance 0
    const dq = k.idOf('DATA_ISSUE');
    expect(codesOf(check(k, [claim('observation', [dq], 'The attendance rate is unavailable because expected attendance is zero.')]))).toEqual([]);
    // mixed with a business finding the exemption does not apply
    const gifts = k.idOf('GIFTS_UNDISTRIBUTED');
    expect(codesOf(check(k, [claim('observation', [gifts, dq], 'Gifts are undistributed because expected attendance is zero.')]))).toContain('CAUSAL_NOT_HYPOTHESIS');
  });
});

describe('undefined metrics, terminology and missing data', () => {
  const sup = ctx('SUP-02');
  const campMissing = ctx('CAM-06'); // target missing

  it('metrics the data does not contain cannot be stated as facts (en, ar, fr)', () => {
    const att = sup.idOf('ATTENDANCE_GAP');
    for (const text of ['Revenue per visit fell with attendance.', 'تراجع معدل التحويل مع انخفاض الحضور.', "Le chiffre d'affaires baisse avec la présence.", 'Customer satisfaction is low where attendance is low.']) {
      expect(codesOf(check(sup, [claim('observation', [att], text)])), text).toContain('UNDEFINED_METRIC');
    }
  });

  it('attendance cannot be given a population (en, ar, fr)', () => {
    const att = sup.idOf('ATTENDANCE_GAP');
    for (const text of ['Only 30 staff members were present out of 50 expected.', 'حضر 30 من الموظفين فقط.', "Seuls 30 employés étaient présents.", 'Only 30 Animateurs were present.']) {
      expect(codesOf(check(sup, [claim('observation', [att], text)])), text).toContain('UNDEFINED_TERM');
    }
    expect(codesOf(check(sup, [claim('observation', [att], 'Attendance is 60 percent: 30 present out of 50 expected, 20 missing.')]))).toEqual([]);
  });

  it('animateur reports may name Animateur labels (the entities are defined there)', () => {
    const a = ctx('ANI-04');
    expect(codesOf(check(a, [claim('observation', [a.idOf('TARGET_BELOW', 'A1')], 'Animateur A1 sold 70 units against a target of 100.')]))).toEqual([]);
  });

  it('a figure for an unavailable metric is not accepted (target missing: no attainment of 0)', () => {
    const dq = campMissing.idOf('DATA_ISSUE');
    expect(codesOf(check(campMissing, [claim('observation', [dq], 'The target is missing, so attainment is 0 percent.')]))).toContain('UNGROUNDED_NUMBER');
    expect(codesOf(check(campMissing, [claim('observation', [dq], 'The target is missing, so attainment against it is unavailable and must be verified.')]))).toEqual([]);
  });
});

describe('labels the finding legitimately involves', () => {
  it('a period finding may name the previous period; a data issue may name the entities it concerns', () => {
    const c = ctx('SAL-02');
    const p3 = c.idOf('PERIOD_INCREASE', 'P3');
    expect(codesOf(check(c, [claim('observation', [p3], 'Units in P3 rose by 20 to 140 from 120, after P2.')]))).toEqual([]);
    const d = ctx('SAL-08'); // S2 has no target
    const dq = d.idOf('DATA_ISSUE');
    expect(codesOf(check(d, [claim('observation', [dq], 'The target of S2 is missing, so its attainment is unavailable.')]))).toEqual([]);
    expect(codesOf(check(d, [claim('observation', [dq], 'The target of S3 is missing, so its attainment is unavailable.')]))).toContain('UNGROUNDED_LABEL');
    const dup = ctx('ANI-07');
    expect(codesOf(check(dup, [claim('observation', [dup.idOf('DATA_ISSUE')], 'The label A1 appears twice, so the figures are ambiguous and must be verified.')]))).toEqual([]);
  });
  it('a recommendation to verify data needs no restated acknowledgement; an observation about conflicting data does', () => {
    const k = ctx('SUP-07');
    const dq = k.idOf('DATA_ISSUE');
    expect(codesOf(check(k, [claim('recommendation', [dq], 'Review the attendance source records.')]))).toEqual([]);
    expect(codesOf(check(k, [claim('observation', [dq], 'Attendance shows 60 present out of 50 expected.')]))).toContain('DATA_CONFLICT_UNACKNOWLEDGED');
    expect(codesOf(check(k, [claim('recommendation', [dq], 'يوصى بالتحقق من بيانات الحضور.')]))).toEqual([]);
  });
});

describe('grounding in the cited findings', () => {
  const c = ctx('SAL-11'); // S9, S11, S4 below target
  const f9 = c.idOf('TARGET_BELOW', 'S9');

  it('a claim may only mention labels of the findings it cites', () => {
    expect(codesOf(check(c, [claim('observation', [f9], 'S9 sold 30 units against a target of 100, and S11 is also low.')]))).toContain('UNGROUNDED_LABEL');
    expect(codesOf(check(c, [claim('observation', [f9, c.idOf('TARGET_BELOW', 'S11')], 'S9 sold 30 units and S11 sold 40 units, both against a target of 100.')]))).toEqual([]);
  });

  it('an observation may only restate figures of the findings it cites', () => {
    expect(codesOf(check(c, [claim('observation', [f9], 'S9 sold 30 units against a target of 100; S11 sold 40.')]))).toContain('UNGROUNDED_LABEL');
    expect(codesOf(check(c, [claim('observation', [f9], 'S9 sold 30 units against a target of 100, 70 below, with attainment of 85 percent.')]))).toContain('UNGROUNDED_NUMBER');
    expect(codesOf(check(c, [claim('observation', [f9], 'S9 sold 30 units against a target of 100, 70 below (30 percent attainment).')]))).toEqual([]);
  });

  it('Arabic-Indic digits are read as the same numbers', () => {
    expect(codesOf(check(c, [claim('observation', [f9], 'باع S9 ٣٠ وحدة مقابل هدف ١٠٠.')]))).toEqual([]);
    expect(codesOf(check(c, [claim('observation', [f9], 'باع S9 ٧٧ وحدة مقابل هدف ١٠٠.')]))).toContain('UNGROUNDED_NUMBER');
  });
});

describe('contradictions with the findings (en, ar, fr)', () => {
  const c = ctx('SAL-02'); // S2 below target, P2 and P3 increases
  const f2 = c.idOf('TARGET_BELOW', 'S2');
  it('direction words that contradict the cited finding are rejected', () => {
    for (const text of ['S2 exceeded its target of 100.', 'تجاوز S2 هدفه.', "S2 dépasse l'objectif de 100."]) {
      expect(codesOf(check(c, [claim('observation', [f2], text)])), text).toContain('CONTRADICTS_FINDING');
    }
  });
  it('negation and "without" do not trigger it', () => {
    for (const text of ['S2 did not exceed its target of 100.', 'لم يتجاوز S2 هدفه.', "S2 n'a pas dépassé l'objectif.", 'S2 is below its target of 100.']) {
      expect(codesOf(check(c, [claim('observation', [f2], text)])), text).toEqual([]);
    }
  });
  it('a period stated as falling when the finding says it rose', () => {
    const p2 = c.idOf('PERIOD_INCREASE', 'P2');
    expect(codesOf(check(c, [claim('observation', [p2], 'Units in P2 fell by 20.')]))).toContain('CONTRADICTS_FINDING');
    expect(codesOf(check(c, [claim('observation', [p2], 'Units in P2 rose by 20 to 120 from 100.')]))).toEqual([]);
  });
  it('group trend: sales stated as rising when the finding says they fell', () => {
    const s = ctx('SUP-03');
    expect(codesOf(check(s, [claim('observation', [s.idOf('SALES_DECLINE')], 'Sales rose to 85 units from 120.')]))).toContain('CONTRADICTS_FINDING');
  });

  it('impossible data narrated as normal is rejected; acknowledging it is accepted (en, ar, fr)', () => {
    const k = ctx('SUP-07'); // present 60 > expected 50
    const dq = k.idOf('DATA_ISSUE');
    expect(codesOf(check(k, [claim('observation', [dq], 'Attendance is excellent at 120 percent.')]))).toContain('DATA_CONFLICT_UNACKNOWLEDGED');
    for (const text of ['Present exceeds expected, so the attendance data is inconsistent.', 'عدد الحاضرين يتجاوز المتوقع والبيانات غير متسقة.', 'Le nombre de présents dépasse le prévu : données incohérentes.']) {
      expect(codesOf(check(k, [claim('observation', [dq], text)])), text).not.toContain('DATA_CONFLICT_UNACKNOWLEDGED');
    }
  });

  it('no finding is built on the contradictory data in the first place', () => {
    const k = ctx('SUP-07');
    expect(k.findings.some((f) => f.type.startsWith('ATTENDANCE'))).toBe(false);
  });
});

describe('the headline is validated like a claim', () => {
  const c = ctx('CAM-02');
  const claims = [claim('observation', [c.idOf('SALES_TARGET_SHORTFALL')], 'Sales reached 90 units against a target of 150, a shortfall of 60 (40 percent).')];
  it('a causal headline is removed even when hedged; a factual one is kept', () => {
    expect(check(c, claims, 'Sales are low because of poor execution.').reply.headline).toBeUndefined();
    expect(check(c, claims, 'Sales may be low because of weak promotion.').reply.headline).toBeUndefined();
    expect(check(c, claims, 'Sales are below target and attendance is down.').reply.headline).toBeTruthy();
  });
  it('a headline with an unknown label, an invented metric or a role is removed', () => {
    expect(check(c, claims, 'Sales fell at PDV-031.').reply.headline).toBeUndefined();
    expect(check(c, claims, 'Revenue is below target.').reply.headline).toBeUndefined();
    expect(check(c, claims, 'Staff attendance is low.').reply.headline).toBeUndefined();
  });
  it('the report then uses the code headline', async () => {
    const s = scenario('CAM-02');
    const reply = JSON.stringify({ headline: 'Sales are low because of poor execution.', claims: claims.map(({ kind, findingIds, text }) => ({ kind, findingIds, text })) });
    const llm = createLlm({ callModel: async () => ({ text: reply, model: 'm' }) });
    const r = await createPipeline({ llm, callback: { post: async () => ({ ok: true }) }, outputMode: 'claims' }).process(buildRequest(s, 'en', crypto.randomUUID()), s.cap);
    expect(r.output.narrative).not.toMatch(/because/);
    expect(r.output.narrative).toMatch(/^Sales reached 90 units against a target of 150, a shortfall of 60/);
  });
});

describe('pipeline: one repair with a precise hint, then safe rejection', () => {
  const s = scenario('SAL-02');
  const c = ctx('SAL-02');
  const f2 = c.idOf('TARGET_BELOW', 'S2');
  const good = [claim('observation', [f2], 'S2 sold 45 units against a target of 100.'), claim('recommendation', [f2], 'Review S2 with the Superviseur.')];
  const bad = [...good, claim('interpretation', [f2], 'S2 is below target because of weak promotion.')];
  const wire = (claims) => JSON.stringify({ claims });

  function run(replies, outputMode = 'claims') {
    const calls = [];
    const llm = createLlm({ callModel: async ({ user }) => { calls.push(user); return { text: replies[Math.min(calls.length - 1, replies.length - 1)], model: 'm' }; } });
    return createPipeline({ llm, callback: { post: async () => ({ ok: true }) }, outputMode })
      .process(buildRequest(s, 'en', crypto.randomUUID()), s.cap).then((r) => ({ r, calls }));
  }

  it('a violation triggers the repair with the rule codes in the hint; a clean second reply is accepted', async () => {
    const { r, calls } = await run([wire(bad), wire(good)]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatch(/rejected \(CLAIM_RULES\)/);
    expect(calls[1]).toMatch(/claim 3 -> CAUSAL_NOT_HYPOTHESIS/);
    expect(r.diagnostics.state).toBe('repaired');
    expect(r.output.insights.rejected).toBeUndefined();
  });

  it('a persistent violation removes only the offending claim and keeps the AI report (no fallback)', async () => {
    const { r } = await run([wire(bad), wire(bad)]);
    expect(r.diagnostics.state).toBe('repaired');
    expect(r.output.fallback).toBeUndefined();
    expect(JSON.stringify(r.output)).not.toMatch(/because of weak promotion/);
    expect(r.output.insights.rejected).toEqual([{ reason: 'CAUSAL_NOT_HYPOTHESIS', kind: 'interpretation' }]);
    expect(r.output.anomalies).toContain('S2 sold 45 units against a target of 100.');
  });

  it('when every claim is rejected the report is still complete (code statements for the top findings)', async () => {
    const allBad = [claim('observation', [f2], 'S2 trails because of poor execution.'), claim('recommendation', [f2], 'Retrain S2 because it caused the gap.')];
    const { r } = await run([wire(allBad), wire(allBad)]);
    expect(r.output.anomalies.join(' ')).toMatch(/S2 sold 45 units against a target of 100/);
    expect(r.output.insights.claims.every((x) => x.source === 'code')).toBe(true);
    expect(r.output.insights.rejected).toHaveLength(2);
  });

  it('a hedged cause is downgraded on the first pass without a retry and is marked in insights', async () => {
    const hedged = [...good, claim('observation', [f2], 'S2 is below target, possibly because of weak promotion.')];
    const { r, calls } = await run([wire(hedged)]);
    expect(calls).toHaveLength(1);
    expect(r.diagnostics.state).toBe('first_pass');
    const dg = r.output.insights.claims.find((x) => x.downgradedFrom);
    expect(dg).toMatchObject({ kind: 'hypothesis', downgradedFrom: 'observation' });
    expect(r.output.anomalies).toContain('S2 is below target, possibly because of weak promotion.');
  });

  it('legacy mode is untouched: no claim rules, no insights', async () => {
    const legacy = JSON.stringify({ locale: 'en', ranking: [], trends: ['S2 sold 45 units.'], anomalies: ['S2 is below target because of weak promotion.'], recommendedActions: ['Review S2.'] });
    const { r } = await run([legacy], 'legacy');
    expect(r.diagnostics.state).toBe('first_pass');
    expect(r.output.insights).toBeUndefined();
    expect(r.output.anomalies[0]).toMatch(/because of weak promotion/); // legacy behaviour, preserved as before
  });
});

describe('the rules do not over-reject faithful reports', () => {
  it('rendering each scenario\'s own findings as observations raises no violation (en and ar)', () => {
    let checked = 0;
    for (const s of SCENARIOS) {
      const c = ctx(s.id);
      for (const locale of ['en', 'ar']) {
        const claims = c.findings.slice(0, 6).map((f) => claim('observation', [f.id], renderFinding(f, locale)));
        const r = checkClaims({ reply: { claims }, findings: c.findings, capabilityId: s.cap, kpis: c.kpis, data: c.data });
        const rejects = r.violations.filter((v) => v.action === 'reject');
        expect(rejects.map((v) => `${v.where}:${v.code}`), `${s.id}/${locale}`).toEqual([]);
        checked += claims.length;
      }
    }
    expect(checked).toBeGreaterThan(300);
  });
});

describe('what is not a cause (false rejections found by replaying real Qwen claims)', () => {
  const c = ctx('SAL-02');
  const f2 = c.idOf('TARGET_BELOW', 'S2');
  it('a recommendation to investigate "root causes" does not assert one', () => {
    expect(codesOf(check(c, [claim('recommendation', [f2], 'Review S2 to identify and address the root causes of the 55-unit gap.')]))).toEqual([]);
    expect(codesOf(check(c, [claim('observation', [f2], 'Poor coaching causes the gap.')]))).toEqual([]); // known limit: bare verb "causes" is not matched
  });
  it('an explanation of a data limitation is allowed, a business cause that mentions "missing" is not', () => {
    expect(codesOf(check(c, [claim('observation', [f2], 'Due to the missing target, its relative performance cannot be determined.')]))).toEqual([]);
    expect(codesOf(check(c, [claim('observation', [f2], 'Because of missing stock, S2 sold less.')]))).toContain('CAUSAL_NOT_HYPOTHESIS');
    expect(codesOf(check(c, [claim('observation', [f2], 'انخفضت مبيعات S2 بسبب نقص التدريب.')]))).toContain('CAUSAL_NOT_HYPOTHESIS');
  });
  it('"which led to the absence of 10" restates arithmetic', () => {
    expect(codesOf(check(c, [claim('observation', [f2], 'حضر 40 من أصل 50 متوقعاً، مما أدى إلى غياب 10.')]))).not.toContain('CAUSAL_NOT_HYPOTHESIS');
  });
});

describe('direction is checked against every finding about the entity (found live: ANI-06, Arabic)', () => {
  const a = ctx('ANI-06'); // A2: 90 of 100 -> TARGET_BELOW(A2)
  const lowest = a.findings.find((f) => f.type === 'LOWEST_ATTENDANCE' && f.entity === 'A2')?.id ?? a.findings.find((f) => f.entity === 'A2' && f.type !== 'TARGET_BELOW')?.id;
  it('a hypothesis that cites only an unrelated finding still cannot say A2 exceeded its target', () => {
    for (const text of ['A2 may have exceeded its sales target while attendance was low.', 'قد يكون انخفاض حضور A2 سبباً محتملاً لتجاوزه هدف المبيعات.', "A2 pourrait avoir dépassé l'objectif de ventes."]) {
      expect(codesOf(check(a, [claim('hypothesis', [lowest], text)])), text).toContain('CONTRADICTS_FINDING');
    }
    expect(codesOf(check(a, [claim('hypothesis', [lowest], 'Low attendance may explain why A2 stayed below its target; worth verifying.')]))).toEqual([]);
  });
});

describe('French accents are matched (JavaScript \b and \w only know ASCII)', () => {
  const c = ctx('SAL-02');
  const f2 = c.idOf('TARGET_BELOW', 'S2');
  it('accented forms are recognised by every rule family', () => {
    expect(codesOf(check(c, [claim('observation', [f2], "S2 est en retard dû à la saisonnalité.")]))).toContain('CAUSAL_NOT_HYPOTHESIS');
    expect(codesOf(check(c, [claim('observation', [f2], "S2 est sous l'objectif à cause de la pluie.")]))).toContain('CAUSAL_NOT_HYPOTHESIS');
    expect(codesOf(check(c, [claim('observation', [f2], "S2 a dépassé l'objectif de 100.")]))).toContain('CONTRADICTS_FINDING');
    expect(codesOf(check(c, [claim('hypothesis', [f2], 'La baisse de S2 est liée à la météo.')]))).toContain('HYPOTHESIS_NOT_HEDGED');
    expect(codesOf(check(c, [claim('hypothesis', [f2], "La baisse de S2 pourrait être liée à la météo, à vérifier.")]))).toEqual([]);
  });
});

// ---- defects found in the P4 audit (D1-D5), each reproduced by the audit probes ----
describe('D1: the missing share of attendance is a finding value (no judge/service disagreement)', () => {
  it('"a 20 percent shortfall" is accepted when 10 of 50 are missing', () => {
    const c = ctx('SUP-06'); // 40 present of 50 expected
    const att = c.findings.find((f) => f.type === 'ATTENDANCE_GAP');
    expect(att.values).toMatchObject({ missingCount: 10, missingPct: 20, attendanceRate: 0.8 });
    const text = 'Attendance is 80 percent: 40 present out of 50 expected, 10 missing, a 20 percent shortfall.';
    expect(codesOf(check(c, [claim('observation', [att.id], text)]))).toEqual([]);
    expect(codesOf(check(c, [claim('observation', [att.id], 'Attendance is 80 percent, a 35 percent shortfall.')]))).toContain('UNGROUNDED_NUMBER');
  });
});

describe('D2: an explicit cause only supports a sentence that names its own code', () => {
  const kc = ctx('SAL-02', { causes: [{ label: 'S2', code: 'STK-01' }] });
  const f1 = kc.idOf('TARGET_BELOW', 'S2');
  const fc = kc.idOf('KNOWN_CAUSE', 'S2');
  it('citing the cause while inventing another explanation is rejected', () => {
    expect(codesOf(check(kc, [claim('observation', [f1, fc], 'S2 is below target because of weak promotion.')]))).toContain('CAUSAL_NOT_HYPOTHESIS');
    expect(codesOf(check(kc, [claim('observation', [f1, fc], 'S2 is below target because of bad weather.')]))).toContain('CAUSAL_NOT_HYPOTHESIS');
    expect(codesOf(check(kc, [claim('observation', [f1, fc], 'S2 is below target because of cause STK-01.')]))).toEqual([]);
    expect(codesOf(check(kc, [claim('observation', [f1, fc], 'S2 est sous son objectif à cause du motif STK-01.')]))).toEqual([]);
  });
  it('a group-level cause cannot justify an invented explanation either', () => {
    const grp = ctx('SAL-02', { causes: [{ code: 'STK-02' }] });
    const ids = [grp.idOf('TARGET_BELOW', 'S2'), grp.findings.find((f) => f.type === 'KNOWN_CAUSE').id];
    expect(codesOf(check(grp, [claim('observation', ids, 'S2 is below target because of a strike.')]))).toContain('CAUSAL_NOT_HYPOTHESIS');
    expect(codesOf(check(grp, [claim('observation', ids, 'S2 is below target because of cause STK-02.')]))).toEqual([]);
  });
  it('an unhedged hypothesis that does not name the code still needs a hedge', () => {
    expect(codesOf(check(kc, [claim('hypothesis', [f1, fc], 'S2 is low because stock ran out.')]))).toContain('HYPOTHESIS_NOT_HEDGED');
    expect(codesOf(check(kc, [claim('hypothesis', [f1, fc], 'Cause STK-01 explains the S2 gap.')]))).toEqual([]);
  });
});

describe('D3: French elisions are detected', () => {
  const c = ctx('SAL-02');
  const f2 = c.idOf('TARGET_BELOW', 'S2');
  it("\"à cause d'une\", \"en raison d'un\", \"à cause du\" (straight and typographic apostrophes)", () => {
    for (const text of ["S2 est sous l'objectif à cause d'une faible promotion.", "S2 est sous l'objectif en raison d'un manque de visibilité.", 'S2 est sous son objectif à cause du climat.', 'S2 est sous son objectif à cause d’une grève.']) {
      expect(codesOf(check(c, [claim('observation', [f2], text)])), text).toContain('CAUSAL_NOT_HYPOTHESIS');
    }
    expect(codesOf(check(c, [claim('observation', [f2], "S2 pourrait être sous son objectif à cause d'une faible promotion.")]))).not.toContain('CAUSAL_NOT_HYPOTHESIS');
  });
});

describe('D4: a hedge only counts in the same clause as the cause', () => {
  const c = ctx('SAL-02');
  const f2 = c.idOf('TARGET_BELOW', 'S2');
  it('a hedge elsewhere in the sentence no longer turns an asserted cause into a hypothesis', () => {
    for (const text of ['S2 is below target because of weak promotion, which may be fixed next month.', 'S2 is below target because of weak promotion, but it could improve.', "S2 est sous l'objectif car la promotion est faible, mais cela pourrait changer."]) {
      expect(codesOf(check(c, [claim('observation', [f2], text)])), text).toContain('CAUSAL_NOT_HYPOTHESIS');
    }
  });
  it('a bare conditional is not a hedge (en, ar, fr)', () => {
    for (const text of ['S2 is below target because of weak promotion if nothing changes.', 'S2 أقل من هدفه بسبب ضعف الترويج إذا لم يتغير شيء.', "S2 est sous l'objectif car la promotion est faible si rien ne change."]) {
      expect(codesOf(check(c, [claim('observation', [f2], text)])), text).toContain('CAUSAL_NOT_HYPOTHESIS');
    }
  });
  it('a hedge in the same clause still downgrades (before or after the connector)', () => {
    for (const text of ['S2 may be below target because of weak promotion.', 'Perhaps because of weak promotion, S2 is below target.', 'S2 is below target, possibly because of weak promotion.', 'قد يكون S2 أقل من هدفه بسبب ضعف الترويج.', "S2 est sous l'objectif, peut-être à cause de la promotion."]) {
      const r = check(c, [claim('observation', [f2], text)]);
      expect(codesOf(r), text).not.toContain('CAUSAL_NOT_HYPOTHESIS');
      expect(r.reply.claims[0].kind, text).toBe('hypothesis');
    }
  });
  it('data-limitation and arithmetic exemptions still hold across clauses', () => {
    expect(codesOf(check(c, [claim('observation', [f2], 'Due to the missing target, relative performance cannot be determined.')]))).toEqual([]);
    expect(codesOf(check(c, [claim('observation', [f2], 'S2 sold 45 units against 100, which led to a gap of 55 units.')]))).toEqual([]);
  });
});

describe('D5: the same attendance-role policy in the three languages', () => {
  const cam = ctx('CAM-09');
  const att = cam.idOf('ATTENDANCE_GAP');
  it('a bare "team" is allowed everywhere; explicit population nouns are banned everywhere', () => {
    for (const text of ['The team was present: 45 of 50.', 'حضر الفريق: 45 من 50.', "L'équipe était présente : 45 sur 50."]) {
      expect(codesOf(check(cam, [claim('observation', [att], text)])), text).toEqual([]);
    }
    for (const text of ['45 team members were present out of 50.', 'حضر 45 من أعضاء الفريق من أصل 50.', "45 membres de l'équipe étaient présents sur 50.", '45 staff were present.', 'حضر 45 موظفا.', '45 employés étaient présents.']) {
      expect(codesOf(check(cam, [claim('observation', [att], text)])), text).toContain('UNDEFINED_TERM');
    }
  });
});
