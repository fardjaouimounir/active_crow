// Business-accuracy judge. Scores ONE report against a scenario using
// eval/reference.mjs as ground truth. It never calls a model.
//
// Critical gates (any one => FAIL, regardless of score):
//   SCHEMA_INVALID, PII_LEAK, UNKNOWN_LABEL, UNSUPPORTED_NUMBER,
//   WRONG_ATTRIBUTION, WRONG_DIRECTION, WRONG_SUPERLATIVE, WRONG_RANKING,
//   CAUSAL_AS_FACT, DATA_CONFLICT_IGNORED,
//   KPI_WRONG_VALUE, KPI_UNDEFINED_AS_VALUE
// Scored dimensions (0..1): coverage, prioritisation, evidence, relevance, locale.
//
// Number support, attribution, direction and superlative checks are lexical
// heuristics; see eval/lexicon.mjs and the crafted outputs in tests/eval.test.js.

import { OutputSchemas } from '../src/schemas/outputs.js';
import { refKpis, refRows, refDq, refExtremes } from './reference.mjs';
import * as L from './lexicon.mjs';

export const CRITICAL_CODES = [
  'SCHEMA_INVALID', 'PII_LEAK', 'UNKNOWN_LABEL', 'UNSUPPORTED_NUMBER', 'WRONG_ATTRIBUTION',
  'WRONG_DIRECTION', 'WRONG_SUPERLATIVE', 'WRONG_RANKING', 'CAUSAL_AS_FACT',
  'DATA_CONFLICT_IGNORED', 'KPI_WRONG_VALUE', 'KPI_UNDEFINED_AS_VALUE',
];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const canon = (n) => String(Math.round(Math.abs(n) * 1000) / 1000);
const roundTo = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

const NON_PROSE = new Set(['kpis', 'insights', 'dataQuality', 'locale', 'type', 'severity', 'label', 'refs', 'evidence', 'evidenceRefs', 'ranking', 'fallback']);
const REF_KEYS = new Set(['refs', 'evidence', 'evidenceRefs']);
const METRIC_NAMES = new Set([
  'gaptotarget', 'attainmentpct', 'changeunits', 'changepct', 'attendancerate', 'units', 'target', 'visits',
  'attendance', 'sales', 'gifts', 'present', 'expected', 'previousunits', 'distributed', 'planned', 'sellers', 'periods', 'animateurs',
]);

// Fields that propose actions. Direction and superlative checks apply to
// observations only: "boost sales growth" in a recommendation is not a claim
// that sales grew.
const ACTION_KEYS = new Set(['recommendedActions', 'decisions', 'opportunities', 'actions', 'campaignActions']);

function proseOf(value, out = [], key = '', action = false) {
  if (NON_PROSE.has(key)) return out;
  const isAction = action || ACTION_KEYS.has(key);
  if (typeof value === 'string') out.push({ text: value, action: isAction });
  else if (Array.isArray(value)) value.forEach((v) => proseOf(v, out, key, isAction));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => proseOf(v, out, k, isAction));
  return out;
}

function refStrings(value, out = [], key = '') {
  if (key === 'fallback' || key === 'kpis') return out;
  if (typeof value === 'string') {
    if (REF_KEYS.has(key) || key === 'label') out.push({ key, text: value });
  } else if (Array.isArray(value)) value.forEach((v) => refStrings(v, out, key));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => refStrings(v, out, k));
  return out;
}

function addVariants(set, v, rateLike = false) {
  if (!isNum(v)) return;
  const a = Math.abs(v);
  for (const d of [0, 1, 2, 3]) set.add(canon(roundTo(a, d)));
  if (rateLike || (a > 0 && a <= 1 && !Number.isInteger(a))) {
    for (const d of [0, 1, 2, 3]) set.add(canon(roundTo(a * 100, d)));
  }
}

function walkData(value, set, key = '') {
  if (isNum(value)) addVariants(set, value, /rate/i.test(key));
  else if (Array.isArray(value)) value.forEach((v) => walkData(v, set, key));
  else if (value && typeof value === 'object') {
    const leaves = Object.entries(value).filter(([k, v]) => isNum(v) && !/rate/i.test(k)).map(([, v]) => v);
    for (let i = 0; i < leaves.length; i += 1) {
      for (let j = i + 1; j < leaves.length; j += 1) addVariants(set, leaves[i] - leaves[j]);
    }
    const pairs = [['planned', 'distributed'], ['expected', 'present'], ['target', 'units'], ['previousUnits', 'units']];
    for (const [base, other] of pairs) {
      if (isNum(value[base]) && value[base] !== 0 && isNum(value[other])) {
        addVariants(set, ((value[base] - value[other]) / value[base]) * 100); // share missing / remaining / change
        addVariants(set, (value[other] / value[base]) * 100);
      }
    }
    for (const [k, v] of Object.entries(value)) walkData(v, set, k);
  }
}

function allowedNumbers(scenario, kpis, rows) {
  const set = new Set();
  walkData(scenario.data, set);
  for (const [k, v] of Object.entries(kpis)) {
    if (!isNum(v)) continue;
    addVariants(set, v, /rate/i.test(k));
    if (/pct$/i.test(k)) addVariants(set, 100 - v);
    if (/rate$/i.test(k)) addVariants(set, (1 - v) * 100);
  }
  for (const r of rows) {
    for (const k of ['units', 'target', 'gapToTarget', 'attainmentPct', 'visits', 'changeUnits', 'changePct']) addVariants(set, r[k]);
    addVariants(set, r.attendanceRate, true);
    if (isNum(r.attainmentPct)) addVariants(set, 100 - r.attainmentPct);
  }
  return set;
}

function entityNumbers(rows) {
  const byLabel = new Map();
  for (const r of rows) {
    const set = byLabel.get(r.label) ?? new Set();
    for (const k of ['units', 'target', 'gapToTarget', 'attainmentPct', 'visits', 'changeUnits', 'changePct', 'previousUnits']) addVariants(set, r[k]);
    addVariants(set, r.attendanceRate, true);
    if (isNum(r.attainmentPct)) addVariants(set, 100 - r.attainmentPct);
    byLabel.set(r.label, set);
  }
  return byLabel;
}

function globalNumbers(scenario, kpis) {
  const set = new Set();
  // Entity-bound metrics (a single seller's / period's value) are not campaign-wide figures.
  for (const [k, v] of Object.entries(kpis)) if (k !== 'topSellerUnits' && k !== 'lastPeriodUnits') addVariants(set, v, false);
  for (const block of ['attendance', 'sales', 'gifts']) {
    for (const v of Object.values(scenario.data[block] ?? {})) addVariants(set, v);
  }
  return set;
}

function toNumber(token) {
  const t = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(token) ? token.replace(/,/g, '') : token.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const clausesOf = (text) => L.normDigits(text).split(L.CLAUSE_SPLIT).map((c) => c?.trim()).filter(Boolean);
const labelsIn = (text) => [...L.normDigits(text).matchAll(L.LABEL_TOKEN)].map((m) => ({ label: m[0].toUpperCase(), index: m.index }));

export function judge({ scenario, locale, output, diagnostics = {} }) {
  const critical = [];
  const warnings = [];
  const add = (code, detail) => critical.push({ code, detail: String(detail).slice(0, 200) });

  if (!output || typeof output !== 'object' || output.error) {
    return { status: 'no_output', critical: [], warnings: [], dims: {}, score: null, passed: false, errorCode: output?.error?.code ?? 'NO_OUTPUT' };
  }

  const cap = scenario.cap;
  const kpisRef = refKpis(cap, scenario.data);
  const rows = refRows(cap, scenario.data);
  const dq = refDq(cap, scenario.data);
  const extremes = refExtremes(rows);
  const known = new Set(rows.map((r) => r.label.toUpperCase()));
  const proseAll = proseOf(output).map((p) => ({ ...p, text: L.stripMarks(p.text) }));
  const prose = proseAll.map((p) => p.text);
  const observations = proseAll.filter((p) => !p.action).map((p) => p.text);
  const allText = prose.join(' \n ');

  // 1. schema
  const { fallback, ...bare } = output;
  const parsed = OutputSchemas[cap].safeParse(bare);
  if (!parsed.success) add('SCHEMA_INVALID', parsed.error.issues[0]?.message ?? 'schema');

  // 2. PII
  for (const re of L.PII) if (re.test(allText)) add('PII_LEAK', re.source.slice(0, 30));

  // 3. KPIs against the independent reference
  for (const [key, expected] of Object.entries(kpisRef)) {
    if (!(key in (output.kpis ?? {}))) continue;
    const got = output.kpis[key];
    if (expected === null) {
      if (isNum(got)) add('KPI_UNDEFINED_AS_VALUE', `${key}: expected undefined, got ${got}`);
    } else if (!isNum(got) || Math.abs(got - expected) > 0.0011) {
      add('KPI_WRONG_VALUE', `${key}: expected ${expected}, got ${got}`);
    }
  }

  // 4. labels (prose tokens and structural references)
  const unknown = new Set();
  for (const text of prose) {
    for (const { label } of labelsIn(text)) if (!known.has(label)) unknown.add(label);
  }
  for (const { key, text } of refStrings(output)) {
    const c = L.normDigits(text).trim().toUpperCase();
    const isMetric = REF_KEYS.has(key) && METRIC_NAMES.has(c.toLowerCase().split('.')[0]) ;
    const isKpi = REF_KEYS.has(key) && Object.keys(kpisRef).some((k) => k.toUpperCase() === c);
    // data-quality finding codes are shown to the model, so evidence may cite them
    const isDq = REF_KEYS.has(key) && dq.some((d) => d.code === c);
    if (!known.has(c) && !isMetric && !isKpi && !isDq) unknown.add(text.slice(0, 20));
  }
  if (unknown.size > 0) add('UNKNOWN_LABEL', [...unknown].join(', '));

  // 5. numbers: must be supported by the data or by correct arithmetic on it
  const allowed = allowedNumbers(scenario, kpisRef, rows);
  const perEntity = entityNumbers(rows);
  const globals = globalNumbers(scenario, kpisRef);
  const unsupported = new Set();
  const misattributed = new Set();
  for (const text of prose) {
    const norm = L.normDigits(text).replace(L.ISO_DATE, ' ').replace(/^\s*\d+[.)]\s+/, '');
    const stripped = norm.replace(L.LABEL_TOKEN, (m) => ' '.repeat(m.length));
    for (const m of stripped.matchAll(/\d+(?:[.,]\d+)*/g)) {
      const n = toNumber(m[0]);
      if (Number.isNaN(n) || !allowed.has(canon(n))) unsupported.add(m[0]);
    }
    // attribution: nearest label before the number inside the same clause.
    // "respectively" pairs entities and numbers across clauses; not judged (known limit).
    if (/respectively|على التوالي/i.test(text)) continue;
    for (const clause of clausesOf(text)) {
      const labs = labelsIn(clause);
      if (labs.length === 0) continue;
      const cs = clause.replace(L.ISO_DATE, ' ');
      for (const m of cs.replace(L.LABEL_TOKEN, (x) => ' '.repeat(x.length)).matchAll(/\d+(?:[.,]\d+)*/g)) {
        const n = toNumber(m[0]);
        if (Number.isNaN(n)) continue;
        const before = labs.filter((l) => l.index < m.index).at(-1);
        if (!before || !perEntity.has(before.label)) continue;
        const mine = perEntity.get(before.label);
        if (mine.has(canon(n)) || globals.has(canon(n))) continue;
        // Ranges and comparisons ("from 120 (P1) to 150 (P3)", "-10 and -5 respectively") list several
        // entities in one clause, so the number may belong to any of them. Swaps are still caught
        // when each entity has its own clause. (Known limit: a swapped "respectively" is missed.)
        if (new Set(labs.map((l) => l.label)).size > 1 && labs.some((l) => perEntity.get(l.label)?.has(canon(n)))) continue;
        const elsewhere = [...perEntity.entries()].some(([lab, set]) => lab !== before.label && set.has(canon(n)));
        if (elsewhere) misattributed.add(`${before.label}:${m[0]}`);
      }
    }
  }
  if (unsupported.size > 0) add('UNSUPPORTED_NUMBER', [...unsupported].join(', '));
  if (misattributed.size > 0) add('WRONG_ATTRIBUTION', [...misattributed].join(', '));

  // 6. direction and superlatives, one entity per clause (observations only)
  for (const text of observations) {
    for (const clause of clausesOf(text).map((c) => c.replace(/best practices?/gi, ' '))) {
      const labs = [...new Set(labelsIn(clause).map((l) => l.label))].filter((l) => known.has(l));
      const hasNeg = L.NEGATION.test(clause);
      if (labs.length === 1) {
        const row = rows.find((r) => r.label === labs[0] && r.direction);
        if (row && L.TARGET_WORD.test(clause) && !hasNeg) {
          const below = L.BELOW.test(clause);
          const above = L.ABOVE.test(clause);
          if (below !== above) {
            const claim = below ? 'below' : 'above';
            if (claim !== row.direction) add('WRONG_DIRECTION', `${row.label} is ${row.direction} target; text says ${claim}`);
          }
        }
        const person = rows.find((r) => r.label === labs[0] && r.kind !== 'period');
        if (person && !hasNeg) {
          const top = L.TOP_WORD.test(clause);
          const bottom = L.BOTTOM_WORD.test(clause);
          if (top !== bottom) {
            if (top && !extremes.top.has(person.label)) add('WRONG_SUPERLATIVE', `${person.label} is not the best on any metric`);
            if (bottom && !extremes.bottom.has(person.label)) add('WRONG_SUPERLATIVE', `${person.label} is not the worst on any metric`);
          }
        }
      }
      if (labs.length === 0 && !hasNeg && (cap === 'campaign_insights' || cap === 'supervisor_daily_summary')) {
        // campaign-level target direction / sales trend
        const att = kpisRef.targetAttainmentPct;
        if (cap === 'campaign_insights' && isNum(att) && L.TARGET_WORD.test(clause) && L.SALES_WORD.test(clause)) {
          const below = L.BELOW.test(clause);
          const above = L.ABOVE.test(clause);
          if (below !== above && ((below && att > 100) || (above && att < 100))) add('WRONG_DIRECTION', `campaign attainment is ${att}; text says ${below ? 'below' : 'above'}`);
        }
        const delta = kpisRef.unitsDeltaPct;
        if (cap === 'supervisor_daily_summary' && isNum(delta) && L.SALES_WORD.test(clause)) {
          const up = L.UP.test(clause);
          const down = L.DOWN.test(clause);
          if (up !== down && ((up && delta < 0) || (down && delta > 0))) add('WRONG_DIRECTION', `sales change is ${delta}; text says ${up ? 'up' : 'down'}`);
        }
      }
    }
  }

  // 7. ranking (sales): must be ordered by units, no duplicates unless the data has them
  if (cap === 'sales_performance' && Array.isArray(output.ranking)) {
    const units = new Map(rows.filter((r) => r.kind === 'seller').map((r) => [r.label, r.units]));
    const rk = output.ranking.map((x) => String(x).toUpperCase());
    const ordered = rk.every((l, i) => i === 0 || !isNum(units.get(rk[i - 1])) || !isNum(units.get(l)) || units.get(rk[i - 1]) >= units.get(l));
    const sameSet = new Set(rk).size === rk.length && rk.length === units.size && rk.every((l) => units.has(l));
    // With duplicate labels the unit of a label is ambiguous, so the ranking cannot be judged.
    if (!dq.some((d) => d.code === 'DUPLICATE_LABEL') && (!ordered || !sameSet)) add('WRONG_RANKING', rk.join('>'));
  }

  // 8. business causes presented as fact. The data holds no causal information.
  //    Observations only: "determine the cause" in a recommendation is not a claim.
  //    A sentence explaining why a figure is unavailable ("unavailable because the
  //    target is zero") describes the data, not the business, so it is exempt.
  for (const text of observations) {
    for (const sentence of L.normDigits(text).split(/(?<!\d)\.(?=\s|$)|[;؛]/)) {
      if (L.CAUSAL.test(sentence) && !L.HEDGE.test(sentence) && !L.DATA_MECHANICS.test(sentence)) add('CAUSAL_AS_FACT', sentence.trim().slice(0, 100));
    }
  }

  // 9. impossible data must be acknowledged
  const conflicts = dq.filter((d) => d.severity === 'conflict');
  const acknowledged = L.DQ_ACK.test(allText);
  if (conflicts.length > 0 && !acknowledged) add('DATA_CONFLICT_IGNORED', conflicts.map((d) => d.code).join(', '));
  if (dq.some((d) => d.severity === 'missing') && !acknowledged) warnings.push('MISSING_DATA_NOT_MENTIONED');

  if (scenario.ctx && L.PREMATURE_VERDICT.test(allText)) warnings.push('PREMATURE_VERDICT');

  // ---- scored dimensions ----
  const dims = {};
  const posOf = (item) => {
    if (L.TOPICS[item]) { const m = allText.match(L.TOPICS[item]); return m ? m.index : -1; }
    return L.normDigits(allText).toUpperCase().search(new RegExp(`(?<![A-Z0-9])${item.toUpperCase()}(?![A-Z0-9])`));
  };
  const focus = scenario.focus ?? [];
  if (focus.length > 0) {
    const reachable = (item) => posOf(item) >= 0 || refStrings(output).some((r) => r.text.toUpperCase() === item.toUpperCase());
    dims.coverage = focus.filter(reachable).length / focus.length;
    if (scenario.priority && focus.length > 1) {
      const p = posOf(scenario.priority);
      const others = focus.filter((f) => f !== scenario.priority).map(posOf).filter((x) => x >= 0);
      dims.prioritisation = p >= 0 && others.every((o) => p <= o) ? 1 : 0;
    }
  }

  const items = [...(output.attention ?? []), ...(output.risks ?? []), ...(output.coaching ?? [])];
  if (items.length > 0) {
    const withRefs = items.filter((it) => (it.refs ?? it.evidence ?? it.evidenceRefs ?? []).length > 0).length;
    dims.evidence = withRefs / items.length;
  }

  const recs = [
    ...(output.recommendedActions ?? []), ...(output.decisions ?? []), ...(output.opportunities ?? []),
    ...(output.campaignActions ?? []), ...(output.coaching ?? []).flatMap((c) => c.actions ?? []),
  ];
  if (recs.length > 0) {
    const topics = focus.filter((f) => L.TOPICS[f]);
    const labelsFocus = focus.filter((f) => !L.TOPICS[f]).map((f) => f.toUpperCase());
    const relevant = recs.filter((r) => {
      const t = L.normDigits(r);
      const labs = labelsIn(t).map((l) => l.label);
      if (focus.length === 0) return labs.length > 0 || Object.values(L.TOPICS).some((re) => re.test(t));
      return labs.some((l) => labelsFocus.includes(l)) || topics.some((tp) => L.TOPICS[tp].test(t)) || (labelsFocus.length === 0 && labs.length > 0);
    }).length;
    dims.relevance = relevant / recs.length;
  }

  const letters = (allText.match(L.ARABIC_LETTER) ?? []).length;
  const latin = (allText.match(L.LATIN_LETTER) ?? []).length;
  if (letters + latin > 0) {
    if (locale === 'ar') dims.locale = (letters / (letters + latin) >= 0.3 ? 0.5 : 0) + (L.ARABIC_TRADE_TERMS.test(allText) ? 0 : 0.5);
    else dims.locale = letters === 0 ? 1 : 0;
  }

  const WEIGHTS = { coverage: 0.3, prioritisation: 0.2, evidence: 0.15, relevance: 0.2, locale: 0.15 };
  let num = 0;
  let den = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) if (dims[k] !== undefined) { num += w * dims[k]; den += w; }
  const score = den > 0 ? Math.round((num / den) * 1000) / 1000 : null;

  return {
    status: 'judged',
    critical,
    warnings,
    dims,
    score,
    passed: critical.length === 0 && (score === null || score >= 0.7),
    fallback: Boolean(fallback?.used),
    state: diagnostics.state ?? null,
  };
}
