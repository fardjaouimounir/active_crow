import { NON_PROSE_KEYS } from '../schemas/outputs.js';
import { derivedFigures } from './kpis.js';

// Numeric fidelity guard. Every number the model writes in prose must exist in
// an allow-list derived from the REAL input: code-computed KPIs plus the figures
// supplied in the request data (per-seller, per-period, per-animateur, ...).
// The model may not introduce new statistics. What is deliberately ignored:
// identifiers (S1, A2, PDV-031 and any label present in the input), ISO dates
// and list markers. Signs are ignored ("down 15" == "-15"); Arabic-Indic digits
// and Arabic separators are normalised; 84 == 84.0; presentation rounding of an
// allowed figure (15.333 -> 15 / 15.3) is accepted, new arithmetic is not.

const ROUND = 1e6;
const canon = (n) => String(Math.round(n * ROUND) / ROUND);
const roundTo = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

// Arabic-Indic / Extended Arabic-Indic digits and Arabic separators -> ASCII.
export function normaliseDigits(text) {
  return String(text)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/٫/g, '.') // Arabic decimal separator
    .replace(/٬/g, ',') // Arabic thousands separator
    .replace(/٪/g, '%');
}

const RATE_KEY = /rate|ratio|share/i;
const isRateKey = (key) => RATE_KEY.test(String(key));

function addNumber(set, value, rate) {
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  const a = Math.abs(n);
  set.add(canon(a));
  if (rate) {
    const pct = a * 100;
    for (const d of [0, 1, 2]) set.add(canon(roundTo(pct, d)));
  } else {
    for (const d of [0, 1, 2]) set.add(canon(roundTo(a, d)));
  }
}

function walkNumbers(value, set, key = '') {
  if (typeof value === 'number') addNumber(set, value, isRateKey(key));
  else if (Array.isArray(value)) value.forEach((v) => walkNumbers(v, set, key));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walkNumbers(v, set, k);
  }
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

// Only array lengths that come from code-computed ranking are authoritative.
const CODE_DERIVED_ARRAY_KEYS = new Set(['ranking']);

export function buildAllowedNumbers({ kpis = {}, data = {}, output = {}, extra = [] } = {}) {
  const allowed = new Set();
  walkNumbers(kpis, allowed);
  walkNumbers(data, allowed);
  walkNumbers(derivedFigures(data), allowed); // code-computed per-entity gaps / attainment / period change
  walkNumbers(extra, allowed); // code-computed finding values
  if (output && typeof output === 'object') {
    for (const [key, value] of Object.entries(output)) {
      if (CODE_DERIVED_ARRAY_KEYS.has(key) && Array.isArray(value)) allowed.add(canon(value.length));
    }
  }
  return allowed;
}

// Back-compat export (KPI-only allow-list).
export function allowedNumbers(kpis = {}, output = {}) {
  return buildAllowedNumbers({ kpis, output });
}

function collectProse(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectProse(item, out));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (NON_PROSE_KEYS.has(key)) continue;
      collectProse(child, out);
    }
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const GENERIC_ID = /(?<![A-Za-z0-9])[A-Z]{1,4}[-_]?\d+(?:[-_][A-Za-z0-9]+)*(?![A-Za-z0-9])/g; // S1, A2, PDV-031, CMP-1
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const SLASH_DATE = /\b\d{1,4}\/\d{1,2}\/\d{1,4}\b/g;
const LIST_MARKER = /^\s*\d+[.)]\s+/;

function toNumber(token) {
  let t = token;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, ''); // 1,200 / 1,200.5
  else t = t.replace(',', '.'); // 84,5 (decimal comma)
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export function checkNumbers(output, kpis, data = {}, extra = []) {
  const allowed = buildAllowedNumbers({ kpis, data, output, extra });
  const knownLabels = collectStrings(data)
    .filter((s) => /\d/.test(s) && s.length <= 40)
    .sort((a, b) => b.length - a.length);
  const labelRe = knownLabels.length ? new RegExp(knownLabels.map(escapeRe).join('|'), 'g') : null;

  const bad = new Set();
  const contexts = [];
  for (const text of collectProse(output)) {
    let s = normaliseDigits(text).replace(LIST_MARKER, '');
    if (labelRe) s = s.replace(labelRe, ' ');
    s = s.replace(GENERIC_ID, ' ').replace(ISO_DATE, ' ').replace(SLASH_DATE, ' ');
    for (const raw of s.match(/\d+(?:[.,]\d+)*/g) ?? []) {
      const n = toNumber(raw);
      if (Number.isNaN(n) || !allowed.has(canon(Math.abs(n)))) {
        bad.add(raw);
        if (!contexts.includes(text)) contexts.push(text);
      }
    }
  }
  // `contexts` = the model sentences containing a rejected number (for debugging only).
  return { ok: bad.size === 0, offending: [...bad], contexts: contexts.map((t) => t.slice(0, 200)) };
}
