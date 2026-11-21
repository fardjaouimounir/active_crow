import { normaliseDigits } from './number-check.js';
import { derivedFigures, METRICS } from './kpis.js';
import { DQ_SEVERITY } from './data-quality.js';

// Entity-label whitelist. Every label the model uses must be one that the
// request data actually contains, so the report can never attribute a finding
// to an entity (seller, animateur, point of sale, period) that was not supplied.
//   - structural reference fields (refs, evidence, evidenceRefs, coaching label,
//     ranking) must contain only known labels;
//   - label-shaped tokens in prose (S1, A2, PDV-031, CMP-1) must be known labels.
// When the data has no labels at all (supervisor_daily_summary,
// campaign_insights), every reference must be empty and prose may name none.

const REF_KEYS = new Set(['refs', 'evidence', 'evidenceRefs', 'label', 'ranking']);
const SKIP_KEYS = new Set(['kpis', 'dataQuality', 'insights', 'locale', 'type', 'severity']);
const LABEL_TOKEN = /(?<![A-Za-z0-9])[A-Z]{1,4}[-_]?\d+(?:[-_][A-Za-z0-9]+)*(?![A-Za-z0-9])/g;

const canonLabel = (s) => normaliseDigits(String(s)).trim().toUpperCase();

function collectDataLabels(value, out) {
  if (typeof value === 'string') out.add(canonLabel(value));
  else if (Array.isArray(value)) value.forEach((v) => collectDataLabels(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectDataLabels(v, out));
  return out;
}

export function knownLabels(data = {}) {
  return collectDataLabels(data, new Set());
}

function walk(value, key, visit) {
  if (SKIP_KEYS.has(key)) return;
  if (typeof value === 'string') visit(value, key);
  else if (Array.isArray(value)) value.forEach((v) => walk(v, key, visit));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walk(v, k, visit);
  }
}

// Evidence may also cite a supplied field or a code-computed KPI by name
// (attendance, gifts.planned, giftGap). These are references to supplied
// figures, not entities, so they are allowed in evidence fields only.
const EVIDENCE_KEYS = new Set(['refs', 'evidence', 'evidenceRefs']);

function collectFieldNames(value, prefix, out) {
  if (Array.isArray(value)) {
    value.forEach((v) => collectFieldNames(v, prefix, out)); // row fields: units, target, visits...
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  for (const [k, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.add(canonLabel(k));
    out.add(canonLabel(path));
    collectFieldNames(v, path, out);
  }
  return out;
}

// Names of the capability's registered metrics and the request fields they read, plus the
// data-quality finding codes: all are shown to the model, so evidence may cite them even when
// the metric is unavailable ("TARGET_MISSING", "giftGap", "sales.target").
function schemaNames(capabilityId) {
  const out = new Set(Object.keys(DQ_SEVERITY).map(canonLabel));
  for (const m of METRICS[capabilityId] ?? []) {
    out.add(canonLabel(m.id));
    for (const input of m.inputs) {
      const path = input.replace(/[]/g, '');
      out.add(canonLabel(path));
      path.split('.').forEach((seg) => out.add(canonLabel(seg)));
    }
  }
  return out;
}

export function checkLabels(output, data = {}, kpis = {}, capabilityId = null) {
  const known = knownLabels(data);
  const fields = collectFieldNames(data, '', schemaNames(capabilityId));
  collectFieldNames(derivedFigures(data), '', fields); // gapToTarget, attainmentPct, changePct...
  for (const k of Object.keys(kpis ?? {})) fields.add(canonLabel(k));
  const unknown = new Set();
  walk(output, '', (text, key) => {
    if (REF_KEYS.has(key)) {
      const c = canonLabel(text);
      const ok = known.has(c) || (EVIDENCE_KEYS.has(key) && fields.has(c));
      if (!ok) unknown.add(text.slice(0, 20));
      return;
    }
    for (const token of normaliseDigits(text).match(LABEL_TOKEN) ?? []) {
      if (!known.has(canonLabel(token))) unknown.add(token.slice(0, 20));
    }
  });
  return { ok: unknown.size === 0, unknown: [...unknown] };
}
