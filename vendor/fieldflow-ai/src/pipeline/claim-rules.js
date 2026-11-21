import * as L from './lexicon.js';
import { buildAllowedNumbers } from './number-check.js';
import { findingTopic } from './findings.js';

// Deterministic validation of typed claims (and the free-text headline) against
// the code-computed findings. The prompt asks for these behaviours; THIS file
// enforces them, so a model that ignores the prompt cannot get an unsupported
// statement into the report.
//
// Outcome per claim:
//   ok         kept as written
//   downgrade  causal wording that is already hedged -> becomes a hypothesis
//   reject     removed from the report (after one repair attempt, see pipeline)
//
// Rules (code in parentheses):
//  1. A cause or diagnosis stated as fact is not allowed (CAUSAL_NOT_HYPOTHESIS), unless the
//     claim cites a KNOWN_CAUSE finding (explicit evidence in the data) or only cites data-issue
//     findings (the mechanism of a data limitation is known to the code).
//  2. A hypothesis must be hedged (HYPOTHESIS_NOT_HEDGED).
//  3. No metric the service has no data for may be stated as a fact (UNDEFINED_METRIC).
//  4. No role may be given to attendance counts (UNDEFINED_TERM): their population is undefined.
//  5. Labels must belong to the cited findings (UNGROUNDED_LABEL).
//  6. An observation may only restate figures of the findings it cites (UNGROUNDED_NUMBER).
//  7. Direction words must not contradict ANY finding about the same entity or topic (CONTRADICTS_FINDING).
//  8. A claim about a data conflict must say the data is inconsistent / to be verified
//     (DATA_CONFLICT_UNACKNOWLEDGED).
//  9. A headline must lead with the code's priority: when it names adverse topics, the TOP-priority one must be named
//     and named first (HEADLINE_ORDER). The order of the lower ones is free: natural sentences rarely list in a strict order.
//     This one is DROPPED without a repair retry: the code's own statement of finding 1 replaces the headline.
// Same rules, same lexicon structure, for Arabic, English and French text.

const labelsIn = (text) => [...L.normDigits(text).matchAll(L.LABEL_TOKEN)].map((m) => ({ label: m[0].toUpperCase(), index: m.index }));
const clausesOf = (text) => L.normDigits(text).split(L.CLAUSE_SPLIT).map((c) => c?.trim()).filter(Boolean);

function toNumber(token) {
  const t = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(token) ? token.replace(/,/g, '') : token.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const DIRECTION = {
  TARGET_BELOW: 'below', TARGET_ABOVE: 'above', TARGET_MET: 'at',
  SALES_TARGET_SHORTFALL: 'below', SALES_TARGET_EXCEEDED: 'above', SALES_TARGET_MET: 'at',
  SALES_DECLINE: 'down', SALES_GROWTH: 'up', PERIOD_DECLINE: 'down', PERIOD_INCREASE: 'up',
};

// True when a clause states a direction that contradicts `expected` (below/above/at/up/down).
function contradicts(clause, expected) {
  if (L.NEGATION.test(clause)) return false;
  if (expected === 'below' || expected === 'above' || expected === 'at') {
    if (!L.TARGET_WORD.test(clause)) return false;
    const below = L.BELOW.test(clause);
    const above = L.ABOVE.test(clause);
    if (below === above) return false;
    return expected === 'at' ? true : (below ? 'below' : 'above') !== expected;
  }
  const up = L.UP.test(clause);
  const down = L.DOWN.test(clause);
  if (up === down) return false;
  return (up ? 'up' : 'down') !== expected;
}

// Compared with EVERY finding about the same entity / topic, not only the cited ones: saying that A2
// "exceeded its target" contradicts TARGET_BELOW(A2) whichever finding the claim cites.
function directionViolation(text, findings) {
  for (const clause of clausesOf(text)) {
    const labels = [...new Set(labelsIn(clause).map((l) => l.label))];
    if (labels.length > 1) continue; // comparisons across entities are not judged
    const relevant = findings.filter((f) => DIRECTION[f.type] && (labels.length === 1 ? f.entity?.toUpperCase() === labels[0] : !f.entity));
    for (const f of relevant) {
      const isTargetKind = ['below', 'above', 'at'].includes(DIRECTION[f.type]);
      // trend words need a sales/units word (group) or the period label itself (entity)
      if (!isTargetKind && labels.length === 0 && !L.SALES_WORD.test(clause)) continue;
      if (contradicts(clause, DIRECTION[f.type])) return `${f.id} is ${DIRECTION[f.type]}, the text says the opposite`;
    }
  }
  return null;
}

// The KNOWN_CAUSE findings that justify stating a cause in THIS text: the cause belongs to the entity of a
// cited finding (or is group-level) AND the text names the cause's own code. Citing a cause while writing a
// different explanation ("because of weak promotion") is not supported by the data.
function supportingCauses(text, cited) {
  const up = text.toUpperCase();
  return cited.filter((kc) => kc.type === 'KNOWN_CAUSE'
    && (!kc.entity || cited.some((f) => f.type !== 'KNOWN_CAUSE' && f.entity === kc.entity))
    && up.includes(String(kc.code).toUpperCase()));
}

function causalVerdict(kind, text, cited) {
  if (kind === 'hypothesis') return null;
  const dataOnly = cited.length > 0 && cited.every((f) => f.type === 'DATA_ISSUE');
  if (supportingCauses(text, cited).length > 0 || dataOnly) return null;
  const { causal, hedged } = L.causalStatus(text, { diagnostics: kind !== 'recommendation' });
  if (!causal) return null;
  // hedged wording of a cause is a hypothesis: downgrade facts, keep a hedged recommendation as is
  if (hedged) return kind === 'recommendation' ? null : { action: 'downgrade' };
  return { action: 'reject', code: 'CAUSAL_NOT_HYPOTHESIS', detail: 'a cause or diagnosis is stated as fact; only a hedged hypothesis may state one' };
}

// Business topics of the adverse findings, in priority order (a topic once, first rank wins).
const BUSINESS_TOPICS = new Set(['attendance', 'gifts', 'sales']);
function headlineOrderViolation(text, findings) {
  const adverse = [...new Set(findings.filter((f) => f.polarity === 'adverse').map(findingTopic).filter((t) => BUSINESS_TOPICS.has(t)))];
  if (adverse.length < 2) return null;
  const at = Object.fromEntries(adverse.map((t) => [t, text.search(L.TOPIC_WORDS[t])]));
  const mentioned = adverse.filter((t) => at[t] >= 0);
  if (mentioned.length === 0) return null;
  if (!mentioned.includes(adverse[0])) return `names ${mentioned[0]} but not the top-priority ${adverse[0]}`;
  const first = [...mentioned].sort((a, b) => at[a] - at[b])[0];
  return first === adverse[0] ? null : `leads with ${first} but the top-priority topic is ${adverse[0]}`;
}

// Returns the rule violations of ONE text. `kind` is the claim kind ('headline' for the headline).
function checkText({ kind, text, cited, allFindings, capabilityId, kpis, data }) {
  const clean = L.stripMarks(text);
  const out = [];

  const causal = causalVerdict(kind === 'headline' ? 'observation' : kind, clean, cited); // a headline cites nothing: it can never state a cause
  if (causal?.action === 'reject') out.push({ code: causal.code, detail: causal.detail, action: 'reject' });
  if (causal?.action === 'downgrade') {
    if (kind === 'headline') out.push({ code: 'CAUSAL_NOT_HYPOTHESIS', detail: 'a headline must not state or imply a cause', action: 'reject' });
    else out.push({ code: 'DOWNGRADED_TO_HYPOTHESIS', detail: 'hedged cause reclassified as hypothesis', action: 'downgrade' });
  }
  if (kind === 'hypothesis' && supportingCauses(clean, cited).length === 0 && !L.HEDGE.test(clean)) { // a cause the data states (and the text names) needs no hedge
    out.push({ code: 'HYPOTHESIS_NOT_HEDGED', detail: 'a hypothesis must be hedged (may, might, could, worth verifying)', action: 'reject' });
  }
  if ((kind === 'observation' || kind === 'interpretation' || kind === 'headline') && L.UNDEFINED_METRIC.test(clean)) {
    out.push({ code: 'UNDEFINED_METRIC', detail: 'mentions a metric the data does not contain', action: 'reject' });
  }
  if ((capabilityId === 'supervisor_daily_summary' || capabilityId === 'campaign_insights') && L.ROLE_TERMS.test(clean)) {
    out.push({ code: 'UNDEFINED_TERM', detail: 'gives a role to attendance counts, whose population is not defined', action: 'reject' });
  }

  // labels must belong to the cited findings (a headline may use any finding's label)
  const pool = kind === 'headline' ? allFindings : cited;
  const allowedLabels = new Set(pool.flatMap((f) => [f.entity, f.code, ...(f.related ?? [])].filter(Boolean).map((x) => String(x).toUpperCase())));
  const bad = [...new Set(labelsIn(clean).map((l) => l.label))].filter((l) => !allowedLabels.has(l));
  if (bad.length > 0) out.push({ code: 'UNGROUNDED_LABEL', detail: `labels not in the cited findings: ${bad.join(', ')}`, action: 'reject' });

  if (kind === 'observation') {
    const values = cited.map((f) => f.values);
    const base = cited.some((f) => f.type === 'DATA_ISSUE') ? { kpis, data, extra: values } : { extra: values };
    const allowed = buildAllowedNumbers(base);
    const stripped = L.normDigits(clean).replace(L.ISO_DATE, ' ').replace(L.LABEL_TOKEN, ' ');
    const offending = [...new Set([...stripped.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0]))].filter((tok) => {
      const n = toNumber(tok);
      return Number.isNaN(n) || !allowed.has(String(Math.round(Math.abs(n) * 1e6) / 1e6));
    });
    if (offending.length > 0) out.push({ code: 'UNGROUNDED_NUMBER', detail: `figures not in the cited findings: ${offending.join(', ')}`, action: 'reject' });
  }

  if (kind === 'headline') {
    const why = headlineOrderViolation(clean, allFindings);
    if (why) out.push({ code: 'HEADLINE_ORDER', detail: why, action: 'drop' });
  }

  if (kind !== 'headline') {
    const why = directionViolation(clean, allFindings);
    if (why) out.push({ code: 'CONTRADICTS_FINDING', detail: why, action: 'reject' });
    if (kind !== 'recommendation' && cited.some((f) => f.type === 'DATA_ISSUE' && f.severity === 'conflict') && !L.DQ_ACK.test(clean)) {
      out.push({ code: 'DATA_CONFLICT_UNACKNOWLEDGED', detail: 'cites a data conflict without saying the data is inconsistent or must be verified', action: 'reject' });
    }
  }
  return out;
}

// reply = { headline?, claims: [{ kind, findingIds, text }] }
// Returns { reply: adjusted reply (downgrades applied, rejected claims removed), violations }
export function checkClaims({ reply, findings, capabilityId, kpis = {}, data = {} }) {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const violations = [];
  const claims = [];
  const rejectedClaims = [];
  reply.claims.forEach((c, index) => {
    const cited = c.findingIds.map((id) => byId.get(id)).filter(Boolean);
    const found = checkText({ kind: c.kind, text: c.text, cited, allFindings: findings, capabilityId, kpis, data });
    const rejects = found.filter((v) => v.action === 'reject');
    for (const v of found) violations.push({ ...v, where: `claim ${index + 1}`, claimKind: c.kind });
    if (rejects.length > 0) { rejectedClaims.push({ kind: c.kind, findingIds: c.findingIds }); return; }
    if (found.some((v) => v.action === 'downgrade')) claims.push({ ...c, kind: 'hypothesis', downgradedFrom: c.kind });
    else claims.push(c);
  });

  let headline = reply.headline;
  if (headline) {
    const found = checkText({ kind: 'headline', text: headline, cited: [], allFindings: findings, capabilityId, kpis, data });
    const rejects = found.filter((v) => v.action === 'reject');
    for (const v of found) violations.push({ ...v, where: 'headline', claimKind: 'headline' });
    if (rejects.length > 0 || found.some((v) => v.action === 'drop')) headline = undefined;
  }
  return { reply: { ...(headline ? { headline } : {}), claims }, violations, rejectedClaims };
}

export const rejectedOf = (violations) =>
  violations.filter((v) => v.action === 'reject' || v.action === 'drop').map((v) => ({ reason: v.code, kind: v.claimKind }));
