import { z } from 'zod';
import { renderFinding, renderRecommendation, findingRefs, publicFinding } from './findings.js';

// The model does not write the report fields directly. It writes typed CLAIMS,
// each tied to code-computed findings:
//   observation    a fact that is in the findings
//   interpretation what a fact means, derived only from the findings
//   hypothesis     a possible explanation or thing to investigate (never a fact)
//   recommendation a practical action that follows from the findings
// Code validates the structure and renders the claims into the existing output
// fields, so the API contract is unchanged (plus the additive `insights`).

export const CLAIM_KINDS = ['observation', 'interpretation', 'hypothesis', 'recommendation'];

export const ClaimsReplySchema = z
  .object({
    headline: z.string().min(1).optional(),
    claims: z
      .array(z.object({
        kind: z.enum(CLAIM_KINDS),
        findingIds: z.array(z.string()),
        text: z.string().min(1),
      }).strict())
      .max(14),
  })
  .strict();

const MAX_COVERED = 5; // top adverse / data findings that must always be addressed

// Structural validation only (shadow checks for wording come later).
export function validateClaims(reply, findings) {
  const ids = new Set(findings.map((f) => f.id));
  const unknown = new Set();
  let missingRefs = 0;
  for (const c of reply.claims) {
    for (const id of c.findingIds) if (!ids.has(id)) unknown.add(id);
    if (ids.size > 0 && c.findingIds.length === 0) missingRefs += 1;
  }
  if (unknown.size > 0) return { ok: false, code: 'UNKNOWN_FINDING', detail: [...unknown].join(', ') };
  if (missingRefs > 0) return { ok: false, code: 'CLAIM_WITHOUT_FINDING', detail: `${missingRefs} claim(s) cite no finding` };
  return { ok: true };
}

const T = {
  en: {
    verify: 'Verify the source data before acting on these figures.',
    pad: 'Some figures are unavailable because input data is missing or inconsistent.',
    headlinePartial: 'Partial report: some figures are unavailable.',
  },
  ar: {
    verify: 'تحقق من البيانات المصدر قبل اتخاذ إجراء بناءً على هذه الأرقام.',
    pad: 'بعض الأرقام غير متاحة لأن البيانات المدخلة ناقصة أو غير متسقة.',
    headlinePartial: 'تقرير جزئي: بعض الأرقام غير متاحة.',
  },
};

const byId = (findings) => new Map(findings.map((f) => [f.id, f]));
const claimRank = (c, map) => Math.min(...c.findingIds.map((id) => map.get(id)?.rank ?? 999), 999);
const lead = (c, map) => c.findingIds.map((id) => map.get(id)).filter(Boolean).sort((a, b) => a.rank - b.rank)[0] ?? null;

// A claim concerns one entity when all the findings it cites share that entity label.
function claimEntity(c, map) {
  const labels = new Set(c.findingIds.map((id) => map.get(id)?.entity).filter(Boolean));
  const allEntity = c.findingIds.length > 0 && c.findingIds.every((id) => map.get(id)?.entity);
  return allEntity && labels.size === 1 ? [...labels][0] : null;
}

const refsOf = (c, map) => {
  const refs = [];
  for (const id of c.findingIds) for (const r of findingRefs(map.get(id) ?? { metrics: [] })) if (!refs.includes(r)) refs.push(r);
  return refs.slice(0, 4);
};

// Relative severity: first adverse finding high, next two medium, others low.
// Data problems are medium. Not an absolute business severity.
function severityOf(finding, adverseRanks) {
  if (!finding) return 'low';
  if (finding.polarity === 'data') return 'medium';
  const pos = adverseRanks.indexOf(finding.rank);
  return pos === 0 ? 'high' : pos >= 1 && pos <= 2 ? 'medium' : 'low';
}

// Build the claim list (model claims + code-rendered claims for anything important it skipped).
//   reply === null -> deterministic mode: every top finding is stated by code.
export function assembleClaims(reply, findings, locale, { coverAll = false, rejectedClaims = [] } = {}) {
  const t = T[locale === 'ar' ? 'ar' : 'en'];
  const map = byId(findings);
  const claims = (reply?.claims ?? []).map((c) => ({ ...c, source: 'model' }));
  const covered = new Set(claims.filter((c) => c.kind !== 'recommendation').flatMap((c) => c.findingIds));
  const must = (coverAll ? findings : findings.filter((f) => f.polarity === 'adverse' || f.polarity === 'data')).slice(0, MAX_COVERED);
  for (const f of must) {
    if (!covered.has(f.id)) claims.push({ kind: 'observation', findingIds: [f.id], text: renderFinding(f, locale), source: 'code' });
  }
  if (coverAll && findings.some((f) => f.polarity === 'data' && f.severity !== 'info')) {
    claims.push({
      kind: 'recommendation', source: 'code', text: t.verify,
      findingIds: findings.filter((f) => f.polarity === 'data' && f.severity !== 'info').map((f) => f.id).slice(0, 3),
    });
  }
  // D9: when the model's recommendation(s) had to be removed and none is left, the report must not end up without an
  // action. For the finding each removed recommendation was about, the code adds the neutral "review it" action
  // (no cause, no figure). If the model wrote no recommendation at all, nothing is added: that was its choice.
  const removedRecs = rejectedClaims.filter((c) => c.kind === 'recommendation');
  if (removedRecs.length > 0 && !claims.some((c) => c.kind === 'recommendation')) {
    const seen = new Set();
    for (const rc of removedRecs) {
      const f = rc.findingIds.map((id) => map.get(id)).filter(Boolean).sort((a, b) => a.rank - b.rank)[0];
      const text = f && !seen.has(f.id) ? renderRecommendation(f, locale) : null;
      if (!text) continue;
      seen.add(f.id);
      claims.push({ kind: 'recommendation', findingIds: [f.id], text, source: 'code' });
      if (seen.size >= 3) break;
    }
  }
  claims.sort((a, b) => claimRank(a, map) - claimRank(b, map));
  return claims;
}

// Render claims into the capability's existing output fields.
export function renderReport(capabilityId, reply, findings, locale, data, opts = {}) {
  const t = T[locale === 'ar' ? 'ar' : 'en'];
  const map = byId(findings);
  const claims = assembleClaims(reply, findings, locale, opts);
  const facts = claims.filter((c) => c.kind === 'observation' || c.kind === 'interpretation');
  const hypotheses = claims.filter((c) => c.kind === 'hypothesis');
  const recs = claims.filter((c) => c.kind === 'recommendation');
  const polarity = (c) => lead(c, map)?.polarity ?? 'neutral';
  // adverse, data issue, or the weak end of a relative ranking ("lowest units") -> a gap, never a strength
  const adverseLike = (c) => ['adverse', 'data'].includes(polarity(c)) || lead(c, map)?.lean === 'weak';
  const adverseRanks = findings.filter((f) => f.polarity === 'adverse').map((f) => f.rank);
  const isPeriod = (c) => { const f = lead(c, map); return Boolean(f) && (f.type.startsWith('PERIOD_') || f.type.startsWith('SUSTAINED_')); };
  const headline = reply?.headline ?? (findings[0] ? renderFinding(findings[0], locale) : t.headlinePartial);
  const insights = {
    findings: findings.map(publicFinding),
    claims: claims.map((c) => ({ kind: c.kind, findingIds: c.findingIds, text: c.text, source: c.source, ...(c.downgradedFrom ? { downgradedFrom: c.downgradedFrom } : {}) })),
    ...(opts.rejected?.length ? { rejected: opts.rejected } : {}),
  };

  switch (capabilityId) {
    case 'supervisor_daily_summary': {
      const summary = facts.map((c) => c.text).slice(0, 5);
      while (summary.length < 3) summary.push(t.pad);
      return {
        headline,
        summary,
        attention: [
          ...facts.filter(adverseLike).map((c) => ({ type: (lead(c, map)?.type ?? 'finding').toLowerCase(), text: c.text, refs: refsOf(c, map) })),
          ...hypotheses.map((c) => ({ type: 'hypothesis', text: c.text, refs: refsOf(c, map) })),
        ].slice(0, 8),
        recommendedActions: recs.map((c) => c.text).slice(0, 3),
        insights,
      };
    }
    case 'sales_performance':
      return {
        trends: [...facts.filter((c) => isPeriod(c) || !adverseLike(c)).map((c) => c.text)],
        anomalies: [...facts.filter((c) => !isPeriod(c) && adverseLike(c)).map((c) => c.text), ...hypotheses.map((c) => c.text)],
        recommendedActions: recs.map((c) => c.text),
        insights,
      };
    case 'campaign_insights': {
      // When the headline is the code's own statement of finding 1, do not repeat it as the first fact.
      const headlineFromCode = !reply?.headline;
      const candidates = headlineFromCode ? facts.filter((c) => !c.findingIds.includes(findings[0]?.id)) : facts;
      const firstFact = candidates.find((c) => !adverseLike(c)) ?? candidates[0];
      return {
        narrative: [headline, firstFact && firstFact.text !== headline ? firstFact.text : null].filter(Boolean).join(' '),
        risks: [
          ...facts.filter(adverseLike).map((c) => ({ severity: severityOf(lead(c, map), adverseRanks), text: c.text, evidence: refsOf(c, map) })),
          ...hypotheses.map((c) => ({ severity: 'low', text: c.text, evidence: refsOf(c, map) })),
        ],
        opportunities: facts.filter((c) => !adverseLike(c) && c.text !== firstFact?.text).map((c) => c.text),
        decisions: recs.map((c) => c.text),
        insights,
      };
    }
    case 'animateur_coaching': {
      const labels = [...new Set(claims.map((c) => claimEntity(c, map)).filter(Boolean))];
      const order = findings.map((f) => f.entity).filter(Boolean);
      labels.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const coaching = labels.map((label) => {
        const mine = (c) => claimEntity(c, map) === label;
        return {
          label,
          strengths: facts.filter(mine).filter((c) => !adverseLike(c)).map((c) => c.text),
          gaps: [...facts.filter(mine).filter(adverseLike).map((c) => c.text), ...hypotheses.filter(mine).map((c) => c.text)],
          actions: recs.filter(mine).map((c) => c.text),
          evidenceRefs: [label, ...claims.filter(mine).flatMap((c) => refsOf(c, map)).filter((r) => r !== label)].filter((r, i, a) => a.indexOf(r) === i).slice(0, 4),
        };
      });
      return {
        coaching,
        campaignActions: [
          ...recs.filter((c) => !claimEntity(c, map)).map((c) => c.text),
          ...facts.filter((c) => !claimEntity(c, map) && adverseLike(c)).map((c) => c.text),
        ],
        insights,
      };
    }
    default:
      throw new Error(`Unknown capability: ${capabilityId}`);
  }
}

// Findings-based deterministic report (used when the model output cannot be accepted).
export function buildClaimsFallback(capabilityId, locale, kpis, ranking, dq, findings, data) {
  const lang = locale === 'ar' ? 'ar' : 'en';
  const body = renderReport(capabilityId, null, findings, lang, data, { coverAll: true });
  return {
    locale: lang,
    ...(capabilityId === 'sales_performance' ? { ranking } : {}),
    ...body,
    kpis,
    ...(dq.length > 0 ? { dataQuality: dq } : {}),
  };
}
