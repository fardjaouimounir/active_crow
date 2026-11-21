import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { createPipeline } from '../src/pipeline/index.js';
import { createLlm } from '../src/pipeline/llm.js';
import { getCapability, prepareReportData, PROMPT_VERSION } from '../src/capabilities/index.js';
import { extractJsonObject, ModelOutputError } from '../src/pipeline/parse.js';
import { checkNumbers } from '../src/pipeline/number-check.js';
import { classifyProviderError } from '../src/pipeline/errors.js';
import { checkLabels } from '../src/pipeline/label-check.js';

const CAPS = ['supervisor_daily_summary', 'sales_performance', 'campaign_insights', 'animateur_coaching'];
const load = (cap, name = 'happy.json') =>
  JSON.parse(fs.readFileSync(new URL(`../fixtures/${cap}/${name}`, import.meta.url), 'utf8'));
const reply = (cap, locale) =>
  fs.readFileSync(new URL(`./qwen-replies/${cap}.${locale}.txt`, import.meta.url), 'utf8');

// Stub provider that returns scripted raw replies, one per call.
function run(cap, locale, replies, { throwWith } = {}) {
  const body = structuredClone(load(cap));
  body.input.context.locale = locale;
  const calls = [];
  const llm = createLlm({
    callModel: async ({ user }) => {
      calls.push(user);
      if (throwWith) throw throwWith;
      const next = replies[Math.min(calls.length - 1, replies.length - 1)];
      return typeof next === 'string' ? { text: next, model: 'Qwen/Qwen3.8-27B' } : next;
    },
  });
  const pipeline = createPipeline({ llm, outputMode: 'legacy', callback: { post: async () => ({ ok: true, status: 200 }) } });
  return pipeline.process(body, cap).then((r) => ({ r, calls }));
}

describe('realistic Qwen replies are accepted as AI output (no fallback)', () => {
  for (const cap of CAPS) {
    for (const locale of ['en', 'ar']) {
      it(`${cap} / ${locale}: think tags, fences, labels, Arabic digits, seller & animateur figures`, async () => {
        const { r, calls } = await run(cap, locale, [reply(cap, locale)]);
        expect(r.diagnostics.fallbackReason, JSON.stringify(r.diagnostics.attempts)).toBeNull();
        expect(r.modelVersion).not.toContain('fallback');
        expect(r.confidence).toBe(1);
        expect(r.output.fallback).toBeUndefined();
        expect(r.output.locale).toBe(locale);
        expect(calls).toHaveLength(1);
      });
    }
  }

  it('drops chatter keys the model adds outside the schema', async () => {
    const { r } = await run('campaign_insights', 'en', [reply('campaign_insights', 'en')]);
    expect(r.output.notes).toBeUndefined();
  });

  it('uses the code-computed KPIs, never the model-supplied kpis object', async () => {
    const { r } = await run('supervisor_daily_summary', 'en', [reply('supervisor_daily_summary', 'en')]);
    expect(r.output.kpis.attendanceRate).toBe(0.84);
    expect(r.output.kpis.units).toBe(120);
  });
});

describe('parser', () => {
  const obj = '{"a":{"b":1},"c":"x}y"}';
  it.each([
    ['plain', obj],
    ['fenced json', '```json\n' + obj + '\n```'],
    ['fenced no lang', '```\n' + obj + '\n```'],
    ['think then json', '<think>reasoning {not json}</think>\n' + obj],
    ['think then fenced', '<think>x</think>\n```json\n' + obj + '\n```'],
    ['missing opening think tag', 'reasoning...\n</think>\n' + obj],
    ['prose before and after', 'Sure! Here is the report:\n' + obj + '\nHope this helps.'],
    ['uppercase THINK', '<THINK>x</THINK>' + obj],
  ])('extracts the object: %s', (_n, text) => {
    expect(extractJsonObject(text)).toEqual({ a: { b: 1 }, c: 'x}y' });
  });

  it.each([
    ['', 'MODEL_EMPTY_RESPONSE'],
    ['   \n ', 'MODEL_EMPTY_RESPONSE'],
    ['<think>still thinking and never closed', 'MODEL_TRUNCATED_REASONING'],
    ['<think>done</think>', 'MODEL_EMPTY_RESPONSE'],
    ['definitely not json', 'MODEL_JSON_PARSE_FAILED'],
    ['{"a": 1, "b": ', 'MODEL_JSON_PARSE_FAILED'],
    ['{a: 1}', 'MODEL_JSON_PARSE_FAILED'],
  ])('throws a specific error for %j', (text, code) => {
    try {
      extractJsonObject(text);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ModelOutputError);
      expect(error.code).toBe(code);
    }
  });
});

describe('numeric validation', () => {
  const kpis = { attendanceRate: 0.84, units: 120, unitsDeltaPct: -15.333, targetGap: 30 };
  const data = {
    sellers: [{ label: 'S1', units: 120, target: 100 }, { label: 'S2', units: 80, target: 100 }],
    periods: [{ label: 'P2', units: 110 }],
    animateurs: [{ label: 'A1', attendanceRate: 0.9, visits: 4 }],
    pdv: [{ label: 'PDV-031', units: 7 }],
  };
  const ok = (text, k = kpis, d = data) => checkNumbers({ locale: 'en', headline: text, kpis: k }, k, d).ok;

  it('allows code-computed per-entity gap and attainment (S2: 100-80=20, 80 percent)', () => {
    expect(ok('S2 is 20 units under target at 80 percent attainment.')).toBe(true);
    expect(ok('P2 grew 20 units over P1.', kpis, { ...data, periods: [{ label: 'P1', units: 90 }, { label: 'P2', units: 110 }] })).toBe(true);
  });
  it('allows seller, period and animateur figures from the input', () => {
    expect(ok('S2 sold 80 units and P2 reached 110.')).toBe(true);
    expect(ok('A1 attendance 90 percent over 4 visits.')).toBe(true);
  });
  it('still rejects invented metrics', () => {
    expect(ok('S2 sold 81 units.')).toBe(false);
    expect(ok('Sales will reach 500 next week.')).toBe(false);
    expect(ok('Average of 77 units per seller.')).toBe(false);
    expect(ok('S2 is 21 units under target.')).toBe(false);
  });
  it('ignores digits inside identifiers (S1, A2, PDV-031, CMP-1)', () => {
    expect(ok('S1, S2, A2 and PDV-031 and CMP-1 need attention.', { units: 5 }, {})).toBe(true);
  });
  it('ignores ISO dates and list markers but not metrics next to them', () => {
    expect(ok('Report for 2026-11-20.', { units: 5 }, {})).toBe(true);
    expect(ok('1. Call the store.', { units: 5 }, {})).toBe(true);
    expect(ok('Report for 2026-11-20 with 77 units.', { units: 5 }, {})).toBe(false);
  });
  it('handles negatives in either phrasing', () => {
    expect(ok('Units changed -15.333 percent.')).toBe(true);
    expect(ok('Units are down 15.333 percent.')).toBe(true);
    expect(ok('Units fell by 15 percent.')).toBe(true);
    expect(ok('Units fell by 16 percent.')).toBe(false);
  });
  it('treats equivalent formats as equal (84, 84.0, 84%, 84,0)', () => {
    for (const t of ['84', '84.0', '84%', '84,0', '٨٤', '٨٤٫٠']) expect(ok(`Attendance ${t} percent.`), t).toBe(true);
  });
  it('supports Arabic-Indic digits and Arabic decimal separators', () => {
    expect(ok('الحضور ٨٤ بالمئة والتغير ١٥٫٣٣٣ بالمئة.')).toBe(true);
    expect(ok('الحضور ٩٩ بالمئة.')).toBe(false);
    expect(ok('التغير ١٥٫٧ بالمئة.')).toBe(false);
  });
  it('supports thousands separators', () => {
    expect(ok('Total 12,000 units.', { units: 12000 }, {})).toBe(true);
    expect(ok('Total 12,000 units.', { units: 120 }, {})).toBe(false);
  });
});

describe('failure handling: classes are separate and one repair retry is used', () => {
  const cap = 'sales_performance';

  it('repairs once: invalid first reply, valid second reply -> AI output, confidence 0.85', async () => {
    const bad = JSON.stringify({ locale: 'en', trends: ['S2 sold 999 units.'], anomalies: [], recommendedActions: [] });
    const { r, calls } = await run(cap, 'en', [bad, reply(cap, 'en')]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('INVENTED_NUMERALS');
    expect(calls[1]).toContain('999');
    expect(r.diagnostics.state).toBe('repaired');
    expect(r.modelVersion).not.toContain('fallback');
    expect(r.confidence).toBe(0.85);
  });

  it('parse failure twice -> fallback with MODEL_JSON_PARSE_FAILED, never a timeout', async () => {
    const { r, calls } = await run(cap, 'en', ['not json at all']);
    expect(calls).toHaveLength(2);
    expect(r.output.fallback.reasonCode).toBe('MODEL_JSON_PARSE_FAILED');
    expect(r.modelVersion).toContain('deterministic-fallback');
    expect(r.confidence).toBe(0);
  });

  it('validation failure twice -> fallback with INVENTED_NUMERALS', async () => {
    const bad = JSON.stringify({ locale: 'en', trends: ['S2 sold 999 units.'], anomalies: [], recommendedActions: [] });
    const { r } = await run(cap, 'en', [bad]);
    expect(r.output.fallback.reasonCode).toBe('INVENTED_NUMERALS');
  });

  it('schema failure -> SCHEMA_INVALID', async () => {
    const { r } = await run('supervisor_daily_summary', 'en', [JSON.stringify({ headline: 'only a headline' })]);
    expect(r.output.fallback.reasonCode).toBe('SCHEMA_INVALID');
  });

  it('unknown animateur label -> UNKNOWN_LABEL', async () => {
    const bad = JSON.stringify({ locale: 'en', coaching: [{ label: 'Z9', strengths: [], gaps: [], actions: [], evidenceRefs: [] }], campaignActions: [] });
    const { r } = await run('animateur_coaching', 'en', [bad]);
    expect(r.output.fallback.reasonCode).toBe('UNKNOWN_LABEL');
  });

  it('unknown label in a reply that a repair retry fixes -> AI output, confidence 0.85', async () => {
    const bad = reply('supervisor_daily_summary', 'en').replace('"refs": []', '"refs": ["PDV-031"]');
    const { r, calls } = await run('supervisor_daily_summary', 'en', [bad, reply('supervisor_daily_summary', 'en')]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('labels that are not in the input: PDV-031');
    expect(r.diagnostics.state).toBe('repaired');
    expect(r.confidence).toBe(0.85);
  });

  it('token-limit cut-off -> MODEL_OUTPUT_TRUNCATED', async () => {
    const { r } = await run(cap, 'en', [{ text: '{"locale":"en","trends":["S1', model: 'm', finishReason: 'length' }]);
    expect(r.output.fallback.reasonCode).toBe('MODEL_OUTPUT_TRUNCATED');
  });

  it('empty reply -> MODEL_EMPTY_RESPONSE', async () => {
    const { r } = await run(cap, 'en', ['']);
    expect(r.output.fallback.reasonCode).toBe('MODEL_EMPTY_RESPONSE');
  });

  it.each([
    [Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' }), 'AI_MODEL_TIMEOUT'],
    [Object.assign(new Error('401 Incorrect API key'), { status: 401 }), 'AI_AUTH_FAILED'],
    [Object.assign(new Error('Rate limit exceeded'), { status: 429 }), 'AI_RATE_LIMITED'],
    [Object.assign(new Error('model does not exist'), { status: 404 }), 'AI_MODEL_NOT_FOUND'],
    [Object.assign(new Error('Unsupported parameter'), { status: 400 }), 'AI_BAD_REQUEST'],
    [Object.assign(new Error('Internal Server Error'), { status: 500 }), 'AI_UNAVAILABLE'],
    [Object.assign(new Error('Connection error.'), { name: 'APIConnectionError' }), 'AI_UNAVAILABLE'],
  ])('provider error %# is classified without defaulting to timeout', async (error, code) => {
    expect(classifyProviderError(error)).toBe(code);
    const { r, calls } = await run(cap, 'en', ['x'], { throwWith: error });
    expect(calls).toHaveLength(1); // provider errors are not retried
    expect(r.output.fallback.reasonCode).toBe(code);
  });

  it('a template is never reported as AI output', async () => {
    const { r } = await run(cap, 'en', ['nope']);
    expect(r.modelVersion).toMatch(new RegExp(`@deterministic-fallback@${PROMPT_VERSION}$`));
    expect(r.confidence).toBe(0);
    expect(r.output.fallback.used).toBe(true);
  });
});

describe('privacy filtering (nothing personal reaches the prompt)', () => {
  it('rejects forbidden keys at any depth', () => {
    const data = { sellers: [{ label: 'S1', units: 5, name: 'Ahmed' }], periods: [] };
    expect(() => prepareReportData('sales_performance', data)).toThrow(/PII_FIREWALL/);
    expect(() => prepareReportData('sales_performance', { sellers: [{ label: 'S1', contact: { phone: '1' } }] })).toThrow(/PII_FIREWALL/);
  });
  it('rejects person names and free text used as label values', () => {
    for (const label of ['Ahmed Ben Ali', 'Ahmed', 'Mohamed', 'محمد علي']) {
      expect(() => prepareReportData('sales_performance', { sellers: [{ label, units: 5 }], periods: [] }), label).toThrow(/PII_FIREWALL/);
    }
  });
  it('accepts documented labels', () => {
    const data = { sellers: [{ label: 'S1', units: 5 }], periods: [{ label: 'P1', units: 3 }], pdv: [{ label: 'PDV-031' }] };
    expect(prepareReportData('sales_performance', data)).toEqual(data);
  });
  it('rejects phone, email, URL and base64 shaped values', () => {
    for (const v of ['+212 600 123456', 'a@b.com', 'https://x.y/z', 'QUJDREVGR0hJSktMTU5PUFFSU1RV']) {
      expect(() => prepareReportData('sales_performance', { sellers: [{ label: 'S1', ref: v }] }), v).toThrow(/PII_FIREWALL/);
    }
  });
  it('the model prompt contains the labels and figures but no names (end to end)', async () => {
    const { calls } = await run('animateur_coaching', 'en', [reply('animateur_coaching', 'en')]);
    expect(calls[0]).toContain('A1');
    expect(calls[0]).not.toMatch(/Ahmed|@|https?:/);
  });
  it('a request containing a name never reaches the model', async () => {
    const body = structuredClone(load('sales_performance'));
    body.input.context.data.sellers[0].name = 'Ahmed Ben Ali';
    let called = 0;
    const llm = createLlm({ callModel: async () => { called += 1; return '{}'; } });
    const posts = [];
    const p = createPipeline({ llm, outputMode: 'legacy', callback: { post: async (x) => { posts.push(x); return { ok: true }; } } });
    const r = await p.process(body, 'sales_performance');
    expect(called).toBe(0);
    expect(r.output.error.code).toBe('PII_FIREWALL');
  });
});

describe('prompts', () => {
  it.each(CAPS)('%s prompt states which figures may be cited and bans invented statistics', (cap) => {
    for (const locale of ['en', 'ar']) {
      const { system } = getCapability(cap).buildPrompt({ locale, kpis: {}, data: {}, validationError: null });
      expect(system).toMatch(/FIGURES YOU MAY CITE/);
      expect(system).toMatch(/Never invent/);
      expect(system).toMatch(locale === 'ar' ? /Arabic/ : /English/);
      expect(system).toMatch(/Superviseur/);
      expect(system).not.toMatch(/French/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Regression: real Qwen run 7/8. campaign_insights / en rejected with
// INVENTED_NUMERALS "20" on both attempts. For the fixture (attendance 42/50,
// sales 120/150, gifts 80/100) the number 20 is a LEGITIMATE derived figure in
// three natural phrasings, but the campaign KPI set did not expose any of them.
// Figures below are calculated here from the raw source numbers, independently
// of the project's own KPI code.
// ---------------------------------------------------------------------------
describe('regression: campaign_insights en "20" (legitimate derived figure)', () => {
  const cap = 'campaign_insights';
  const src = { present: 42, expected: 50, units: 120, target: 150, distributed: 80, planned: 100 };
  const giftsUndistributed = src.planned - src.distributed; // 20
  const targetShortfallPct = 100 - (src.units / src.target) * 100; // 20
  const giftsRemainingPct = 100 - (src.distributed / src.planned) * 100; // 20

  const replyWith = (narrative, extra = {}) =>
    JSON.stringify({
      locale: 'en',
      narrative,
      risks: [{ severity: 'medium', text: 'Attendance is 84 percent.', evidence: [] }],
      opportunities: ['Push gift distribution.'],
      decisions: ['Review the plan with the supervisor.'],
      ...extra,
    });

  it('the independent calculation gives 20 in all three phrasings', () => {
    expect(giftsUndistributed).toBe(20);
    expect(Math.round(targetShortfallPct * 1000) / 1000).toBe(20);
    expect(Math.round(giftsRemainingPct * 1000) / 1000).toBe(20);
  });

  it('the code-computed campaign KPIs now equal those independent figures', () => {
    const data = load(cap).input.context.data;
    const k = getCapability(cap).computeKpis(data);
    expect(k.giftGap).toBe(giftsUndistributed);
    expect(k.targetShortfallPct).toBeCloseTo(targetShortfallPct, 3);
    expect(k.giftRemainingPct).toBeCloseTo(giftsRemainingPct, 3);
  });

  it.each([
    ['gifts still to distribute', 'The campaign delivered 120 of 150 units, and 20 planned gifts are still undistributed.'],
    ['shortfall to target', 'Sales are 20 percent short of the 150 unit target.'],
    ['remaining gifts share', '20 percent of the 100 planned gifts remain to be distributed.'],
  ])('accepted as real AI output without a repair retry: %s', async (_n, narrative) => {
    const { r, calls } = await run(cap, 'en', [replyWith(narrative)]);
    expect(r.diagnostics.fallbackReason, JSON.stringify(r.diagnostics.attempts)).toBeNull();
    expect(r.diagnostics.state).toBe('first_pass');
    expect(calls).toHaveLength(1);
  });

  it('is NOT hardcoded: with data where 20 is not derivable, 20 is still rejected', async () => {
    const body = structuredClone(load(cap));
    body.input.context.locale = 'en';
    body.input.context.data = {
      attendance: { present: 47, expected: 50 }, // gap 3, rate 94
      sales: { units: 110, target: 150 }, // gap 40, attainment 73.333, shortfall 26.667
      gifts: { distributed: 90, planned: 100 }, // gap 10, remaining 10
    };
    const llm = createLlm({ callModel: async () => ({
        text: replyWith('20 gifts are still undistributed.', { risks: [{ severity: 'medium', text: 'Attendance needs follow-up.', evidence: [] }] }),
        model: 'm',
      }) });
    const p = createPipeline({ llm, outputMode: 'legacy', callback: { post: async () => ({ ok: true }) } });
    const r = await p.process(body, cap);
    expect(r.output.fallback.reasonCode).toBe('INVENTED_NUMERALS');
    const rejected = r.diagnostics.attempts.find((a) => a.code === 'INVENTED_NUMERALS');
    expect(rejected.offending).toEqual(['20']);
    expect(rejected.contexts[0]).toContain('20 gifts');
  });

  it('still rejects unsupported quantities, percentages and time periods in recommendations', () => {
    const data = load(cap).input.context.data;
    const k = getCapability(cap).computeKpis(data);
    for (const text of [
      'Raise sales by 10 percent within 2 weeks.',
      'Add 5 extra visits.',
      'Aim for 25 more units.',
      'Distribute 21 gifts.',
    ]) {
      expect(checkNumbers({ locale: 'en', narrative: text, kpis: k }, k, data).ok, text).toBe(false);
    }
  });

  it('only campaign_insights gets the "no unsupplied quantities" prompt rule', () => {
    for (const id of CAPS) {
      const { system } = getCapability(id).buildPrompt({ locale: 'en', kpis: {}, data: {}, validationError: null });
      if (id === 'campaign_insights') expect(system).toMatch(/must NOT contain any quantity, percentage, target or time period/);
      else expect(system).not.toMatch(/CAMPAIGN RECOMMENDATIONS/);
    }
  });

  it('the other three capabilities keep exactly their previous KPI keys', () => {
    const sup = getCapability('supervisor_daily_summary').computeKpis(load('supervisor_daily_summary').input.context.data);
    expect(Object.keys(sup)).toEqual([
      'presentCount', 'expectedCount', 'missingCount', 'attendanceRate', 'units', 'previousUnits',
      'unitsDeltaPct', 'distributedGifts', 'plannedGifts', 'giftGap', 'giftDistributionRate',
    ]);
    expect(Object.keys(getCapability('sales_performance').computeKpis(load('sales_performance').input.context.data))).toEqual([
      'sellerCount', 'totalUnits', 'totalTarget', 'targetGap', 'targetAttainmentPct', 'topSellerUnits', 'periodCount', 'lastPeriodUnits',
    ]);
    expect(Object.keys(getCapability('animateur_coaching').computeKpis(load('animateur_coaching').input.context.data))).toEqual([
      'animateurCount', 'avgAttendanceRate', 'totalUnits', 'totalTarget', 'targetGap', 'attainmentPct', 'avgVisits',
    ]);
  });
});

describe('entity-label whitelist (no attribution to entities that were not supplied)', () => {
  const sales = load('sales_performance').input.context.data;
  const campaign = load('campaign_insights').input.context.data;
  const anim = load('animateur_coaching').input.context.data;

  it('rejects the previously accepted invented PDV-031 in supervisor refs and prose (en and ar)', () => {
    const sup = load('supervisor_daily_summary').input.context.data;
    expect(checkLabels({ attention: [{ type: 'gifts', text: 'Gifts are short.', refs: ['PDV-031'] }] }, sup))
      .toEqual({ ok: false, unknown: ['PDV-031'] });
    expect(checkLabels({ attention: [{ type: 'gifts', text: 'نقص 20 هدية في PDV-031.', refs: [] }] }, sup).ok).toBe(false);
  });

  it('accepts evidence that cites supplied fields or KPI names (seen from real Qwen), rejects other words', () => {
    const sup = load('supervisor_daily_summary').input.context.data;
    const supKpis = getCapability('supervisor_daily_summary').computeKpis(sup);
    const campKpis = getCapability('campaign_insights').computeKpis(campaign);
    const att = (refs) => ({ attention: [{ type: 'x', text: 'x', refs }] });
    expect(checkLabels(att(['attendance', 'gifts']), sup, supKpis).ok).toBe(true);
    expect(checkLabels(att(['gifts.planned', 'giftGap']), sup, supKpis).ok).toBe(true);
    expect(checkLabels({ risks: [{ severity: 'low', text: 'x', evidence: ['targetGap', 'sales'] }] }, campaign, campKpis).ok).toBe(true);
    expect(checkLabels(att(['stock']), sup, supKpis)).toEqual({ ok: false, unknown: ['stock'] });
    expect(checkLabels(att(['PDV-031']), sup, supKpis).ok).toBe(false);
  });

  it('accepts per-entity metric names in evidenceRefs (seen from real Qwen), but not invented ones', () => {
    const item = (refs) => ({ coaching: [{ label: 'A1', strengths: [], gaps: [], actions: [], evidenceRefs: refs }] });
    const k = getCapability('animateur_coaching').computeKpis(anim);
    expect(checkLabels(item(['A1', 'units', 'target', 'visits', 'attendanceRate', 'gapToTarget']), anim, k).ok).toBe(true);
    expect(checkLabels(item(['conversionRate']), anim, k)).toEqual({ ok: false, unknown: ['conversionRate'] });
  });

  it('field names are not accepted as coaching labels or ranking entries', () => {
    expect(checkLabels({ coaching: [{ label: 'animateurs', strengths: [], gaps: [], actions: [], evidenceRefs: [] }] }, anim).ok).toBe(false);
    expect(checkLabels({ ranking: ['sellers'] }, sales).ok).toBe(false);
  });

  it('rejects invented campaign evidence and points of sale named in decisions', () => {
    expect(checkLabels({ risks: [{ severity: 'low', text: 'x', evidence: ['PDV-031'] }] }, campaign).ok).toBe(false);
    expect(checkLabels({ decisions: ['Add visits at PDV-031.'] }, campaign).ok).toBe(false);
  });

  it('rejects an unknown seller in prose but accepts supplied seller and period labels', () => {
    expect(checkLabels({ trends: ['S9 sold 80 units.'] }, sales)).toEqual({ ok: false, unknown: ['S9'] });
    expect(checkLabels({ ranking: ['S1', 'S2'], trends: ['S1 led; P2 was up on P1.'] }, sales).ok).toBe(true);
  });

  it('rejects unknown animateur evidenceRefs and accepts supplied ones', () => {
    const item = (refs) => ({ coaching: [{ label: 'A1', strengths: [], gaps: [], actions: [], evidenceRefs: refs }] });
    expect(checkLabels(item(['A7']), anim).ok).toBe(false);
    expect(checkLabels(item(['A1', 'A2']), anim).ok).toBe(true);
  });

  it('normalises Arabic-Indic digits and case, and ignores trade terms without digits', () => {
    expect(checkLabels({ trends: ['تصدّر S١ المبيعات في Point de Vente.'] }, sales).ok).toBe(true);
    expect(checkLabels({ trends: ['s2 trails.'] }, sales).ok).toBe(true);
  });

  it('every deterministic fallback passes the label check', () => {
    for (const cap of CAPS) {
      const data = load(cap).input.context.data;
      const def = getCapability(cap);
      const kpis = def.computeKpis(data);
      for (const locale of ['en', 'ar']) {
        expect(checkLabels(def.fallback(locale, kpis, def.computeRanking?.(data) ?? []), data).ok, `${cap}/${locale}`).toBe(true);
      }
    }
  });

  it('campaign_insights keeps its previous KPI keys and adds only the three derived ones', () => {
    expect(Object.keys(getCapability('campaign_insights').computeKpis(campaign))).toEqual([
      'attendanceRate', 'attendanceGap', 'units', 'target', 'targetGap', 'targetAttainmentPct', 'giftDistributionRate',
      'giftGap', 'giftRemainingPct', 'targetShortfallPct',
    ]);
  });

  it('the prompt forbids labels that are not in the input', () => {
    const { system } = getCapability('supervisor_daily_summary').buildPrompt({ locale: 'en', kpis: {}, data: {}, validationError: null });
    expect(system).toMatch(/Use ONLY labels that appear in the input/);
    expect(system).not.toMatch(/PDV-031/);
  });
});
