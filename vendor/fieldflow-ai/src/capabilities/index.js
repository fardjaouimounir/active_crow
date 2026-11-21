import {
  supervisorDailyKpis,
  salesPerformanceKpis,
  campaignInsightsKpis,
  animateurCoachingKpis,
  computeRanking,
  computeCompleteness,
  derivedFigures,
} from '../pipeline/kpis.js';
import { DQ_MEANING } from '../pipeline/data-quality.js';
import { buildFallback } from './fallback.js';

// Bump whenever the prompt or the validation rules change, so stored results
// (modelVersion) can be traced to the rules that produced them.
export const PROMPT_VERSION = 'prompt-v5';


// --- PII firewall (deterministic, runs before any prompt reaches the model) ---

// Keys that are never acceptable in the aggregate payload sent to the model.
const FORBIDDEN_KEYS = new Set([
  'name', 'firstname', 'lastname', 'fullname', 'displayname',
  'phone', 'mobile', 'telephone', 'contact', 'email', 'mail',
  'ssn', 'nationalid', 'id_number', 'passport', 'address',
  'exif', 'gps', 'latitude', 'longitude', 'photo', 'image', 'image_data',
  'file_data', 'base64', 'payload',
]);

const PHONE_RE = /(\+?\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL_RE = /https?:\/\//;
const BASE64_RE = /^[A-Za-z0-9+/]{20,}={0,2}$/;
const MAX_STRING_LEN = 200;

// Every string in the aggregate payload must be a short code/label (A1, S2,
// PDV-031, CMP-1). Free text is rejected, because a person's name cannot be
// told apart from any other word; the contract only allows counts, codes and
// short labels. Forbidden key names are rejected at EVERY depth.
const LABEL_RE = /^[A-Za-z]{1,6}[-_]?\d{1,6}(?:[-_][A-Za-z0-9]{1,6})?$/;

function scanValue(value, path) {
  const problems = [];
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LEN) problems.push(`${path}: string too long`);
    if (PHONE_RE.test(value)) problems.push(`${path}: phone-shaped value`);
    if (EMAIL_RE.test(value)) problems.push(`${path}: email-shaped value`);
    if (URL_RE.test(value)) problems.push(`${path}: URL`);
    if (BASE64_RE.test(value)) problems.push(`${path}: base64-shaped value`);
    if (problems.length === 0 && !LABEL_RE.test(value)) {
      problems.push(`${path}: free-text value (only short codes such as A1, S1, PDV-031 are allowed)`);
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => {
      problems.push(...scanValue(item, `${path}[${i}]`));
    });
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(String(key).toLowerCase())) {
        problems.push(`${path}.${String(key)}: forbidden key`);
        continue;
      }
      problems.push(...scanValue(child, `${path}.${String(key)}`));
    }
  }
  return problems;
}

export function prepareReportData(capabilityId, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {};
  }
  const problems = [];
  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = String(key).toLowerCase();
    if (FORBIDDEN_KEYS.has(lowerKey)) {
      problems.push(`forbidden key: ${key}`);
      continue;
    }
    const found = scanValue(value, key);
    if (found.length > 0) {
      problems.push(...found);
      continue;
    }
    sanitized[key] = value;
  }
  if (problems.length > 0) {
    const err = new Error(`PII_FIREWALL: ${problems.join('; ')}`);
    err.code = 'PII_FIREWALL';
    err.problems = problems;
    throw err;
  }
  return sanitized;
}

const FIGURES = {
  supervisor_daily_summary:
    'the KPI values (counts, gaps, deltas) and the attendance / sales / gifts figures in the input. Rates are written as percentages (0.84 -> 84).',
  sales_performance:
    'the KPI values AND each seller\'s units, target, gapToTarget and attainmentPct and each period\'s units and change, exactly as supplied in the input or in the code-computed per-entity figures, always tied to the label they belong to.',
  campaign_insights:
    'the KPI values (including giftGap, giftRemainingPct, targetShortfallPct and attendanceGap) and the attendance / sales / target / gifts figures supplied in the input.',
  animateur_coaching:
    'the KPI values AND each animateur\'s attendanceRate (as a percentage, 0.9 -> 90), units, target, visits, gapToTarget and attainmentPct exactly as supplied, always tied to that animateur\'s label.',
};

// Extra rules for a single capability (other capabilities are unchanged).
const EXTRA_RULES = {
  campaign_insights: [
    'CAMPAIGN RECOMMENDATIONS:',
    '- Recommendations, risks, opportunities and decisions must NOT contain any quantity, percentage, target or time period that is not supplied (no "within 2 weeks", "raise by 10 percent", "add 5 visits", "20 more units"). State actions qualitatively, or cite only supplied figures.',
  ],
};

function systemPrompt(locale, schemaText, capabilityId) {
  const language =
    locale === 'ar'
      ? 'Arabic (Modern Standard Arabic)'
      : 'English';
  return [
    `You are FieldFlow's field-campaign reporting assistant. Write all prose in ${language}.`,
    'Reply with ONE JSON object only, matching this shape. No <think> text, no Markdown fences, no text before or after the JSON:',
    schemaText,
    'FIGURES YOU MAY CITE:',
    `- Only ${FIGURES[capabilityId] ?? 'the KPI values and input figures'}`,
    '- Copy numbers exactly as supplied. Write numbers with digits 0-9 and "." as the decimal separator (also in Arabic).',
    '- Never invent, estimate or compute a new statistic: no new percentages, sums, differences, averages, counts or forecasts. The code already computed every KPI.',
    '- Write a decrease as a positive number with a word ("down 15"), not as a new figure.',
    '- Do not write dates, years, thresholds or numbered list markers.',
    'EVIDENCE AND RECOMMENDATIONS:',
    '- Base every observation and recommendation on the supplied figures; cite the label it concerns.',
    '- Use ONLY labels that appear in the input (in prose and in refs / evidence / evidenceRefs). If the input contains no labels, name no point of sale, person or entity.',
    '- refs / evidence / evidenceRefs may contain only input labels or the names of supplied fields or KPIs (for example attendance, giftGap).',
    '- Recommendations are encouraged, but must be practical actions justified by supplied evidence, with no invented facts.',
    'DATA QUALITY:',
    '- If the input lists DATA QUALITY findings, state each issue once in plain words, say which figures are unavailable or unreliable, and recommend verifying the data. Never describe contradictory or impossible data as a normal or positive result (for example, attendance above the expected number is not strong attendance).',
    '- Do not invent an explanation for a data problem (no invented periods, causes or events).',
    '- Metrics listed as unavailable must not be stated, estimated or written as 0.',
    'PRIVACY AND STYLE:',
    '- Refer to people and points of sale ONLY by the supplied labels. Never write names, phones, emails, EXIF or photo data.',
    '- Keep each string to at most two short sentences.',
    '- Keep the trade terms Animateur, Superviseur and Point de Vente in Latin script, in both languages.',
    ...(EXTRA_RULES[capabilityId] ?? []),
  ].join('\n');
}

function claimsSystemPrompt(locale, capabilityId) {
  const language = locale === 'ar' ? 'Arabic (Modern Standard Arabic)' : 'English';
  const headlineLine = capabilityId === 'supervisor_daily_summary' || capabilityId === 'campaign_insights'
    ? '  "headline": "one short sentence summarising the situation",'
    : '';
  return [
    `You are FieldFlow's field-campaign reporting assistant. Write all prose in ${language}.`,
    'Reply with ONE JSON object only. No <think> text, no Markdown fences, no text before or after the JSON:',
    `{
${headlineLine ? `${headlineLine}
` : ''}  "claims": [{"kind":"observation|interpretation|hypothesis|recommendation","findingIds":["F1"],"text":"string"}]   // 3 to 12 claims
}`,
    'HOW TO WRITE CLAIMS:',
    '- FINDINGS in the input are computed by code and ranked by priority (F1 first). Explain them. Do not look for other findings.',
    '- observation: restate a fact from a finding with its figures. interpretation: what the fact means for the business, using only the findings. hypothesis: a possible explanation or something to investigate; it must be hedged (may, might, could, worth verifying) and is never stated as a fact. recommendation: a practical action that follows from the cited findings.',
    '- Every claim cites the findingIds it rests on. Never invent a finding id.',
    '- Cover the adverse findings and every data issue (highest priority first) before positive ones. Do not skip them.',
    '- A recommendation names the entity label of the finding it targets when that finding has one. No generic advice.',
    '- CAUSES: a cause or an explanation is a hypothesis. Hedge it (may, might, could, possibly), cite the finding it would explain, and use kind "hypothesis". Only a finding of type KNOWN_CAUSE lets you state a cause as a fact, and only in a claim that cites it. Never write that a result happened "because of", "due to" or that it "reflects" a weakness, defect or failure unless a KNOWN_CAUSE finding is cited. This applies to the headline too.',
    '- Do not invent metrics (no revenue, profit, price, cost, conversion, stock, satisfaction) and do not invent business definitions. Attendance counts concern unspecified attendees: say "present" and "expected" and do not say who they are (no staff, promoters, employees, Animateurs, team).',
    '- A claim may mention only the labels of the findings it cites, and an observation may restate only the figures of the findings it cites.',
    '- If a finding is a data conflict, say that the data is inconsistent or must be verified. Never present it as good or normal.',
    'FIGURES YOU MAY CITE:',
    `- Only ${FIGURES[capabilityId] ?? 'the KPI values and input figures'} Also the values inside FINDINGS.`,
    '- Copy numbers exactly as supplied. Write numbers with digits 0-9 and "." as the decimal separator (also in Arabic).',
    '- Never invent, estimate or compute a new statistic: no new percentages, sums, differences, averages, counts or forecasts. The code already computed every figure.',
    '- Write a decrease as a positive number with a word ("down 15"), not as a new figure.',
    '- Do not write dates, years, thresholds or numbered list markers.',
    'EVIDENCE:',
    '- Base every claim on the supplied figures and findings; cite labels (A1, S2, P3) only if they appear in the input.',
    'DATA QUALITY:',
    '- If the input lists DATA QUALITY findings, state each issue once in plain words, say which figures are unavailable or unreliable, and recommend verifying the data. Never describe contradictory or impossible data as a normal or positive result.',
    '- Do not invent an explanation for a data problem (no invented periods, causes or events). Metrics listed as unavailable must not be stated, estimated or written as 0.',
    'PRIVACY AND STYLE:',
    '- Refer to people and points of sale ONLY by the supplied labels. Never write names, phones, emails, EXIF or photo data.',
    '- Keep each text to at most two short sentences.',
    '- Keep the trade terms Animateur, Superviseur and Point de Vente in Latin script, in both languages.',
    ...(EXTRA_RULES[capabilityId] ?? []),
  ].join('\n');
}

const selectSystem = (args, capabilityId) =>
  args.mode === 'claims' ? claimsSystemPrompt(args.locale, capabilityId) : systemPrompt(args.locale, SCHEMAS[capabilityId], capabilityId);

const REPAIR_HINTS = {
  MODEL_JSON_PARSE_FAILED: 'It was not a single parseable JSON object. Output ONLY the JSON object: no <think>, no Markdown, no commentary.',
  MODEL_EMPTY_RESPONSE: 'It was empty. Output ONLY the JSON object.',
  MODEL_TRUNCATED_REASONING: 'You spent the whole budget reasoning. Answer directly with ONLY the JSON object and keep any reasoning minimal.',
  MODEL_OUTPUT_TRUNCATED: 'It was cut off. Be more concise and output the complete JSON object.',
  SCHEMA_INVALID: 'It did not match the required JSON shape (see the shape above, including item limits).',
  UNKNOWN_LABEL: 'It used a label that is not in the input. Use only the labels supplied.',
  UNKNOWN_FINDING: 'It cited a finding id that does not exist. Cite only the ids listed under FINDINGS.',
  CLAIM_WITHOUT_FINDING: 'Every claim must cite at least one finding id from FINDINGS.',
  CLAIM_RULES: 'Some claims broke the claim rules (listed below). Fix them: state a cause only as a hedged hypothesis (may, might, could), never as a fact; do not name who the attendees are; do not mention metrics that are not supplied; mention only labels of the findings you cite; restate figures only from the findings you cite; never contradict a finding; say that conflicting data is inconsistent or must be verified.',
};

function userPrompt({ kpis, data, findings = [], insights = [], unavailable = [], validationError, previousReply }) {
  const lines = [
    'KPI (code-computed, authoritative):',
    JSON.stringify(kpis),
    '',
    'Aggregated input (labels only):',
    JSON.stringify(data ?? {}),
  ];
  const derived = derivedFigures(data ?? {});
  if (Object.keys(derived).length > 0) {
    lines.push('', 'Code-computed per-entity figures (authoritative, you may cite them):', JSON.stringify(derived));
  }
  if (insights.length > 0) {
    lines.push('', 'FINDINGS (code-computed, ranked by priority, F1 first; cite these ids):');
    for (const f of insights) {
      lines.push(JSON.stringify({ id: f.id, type: f.type, entity: f.entity, polarity: f.polarity, ...(f.code ? { code: f.code } : {}), values: f.values }));
    }
  }
  if (findings.length > 0) {
    lines.push('', 'DATA QUALITY (code-detected, authoritative):');
    for (const f of findings) lines.push(`- ${f.code} (${f.severity}): ${DQ_MEANING[f.code]?.en ?? ''}`);
  }
  if (unavailable.length > 0) {
    lines.push('', `UNAVAILABLE METRICS (cannot be computed from the supplied data; never state, estimate or write 0 for them): ${unavailable.join(', ')}`);
  }
  if (validationError && typeof validationError === 'object') {
    const code = validationError.code;
    let hint = REPAIR_HINTS[code] ?? 'It was rejected.';
    if (code === 'UNKNOWN_LABEL' && Array.isArray(validationError.offending)) {
      hint =
        `It used labels that are not in the input: ${validationError.offending.join(', ')}. ` +
        'Remove them; use only labels supplied in the input, or none.';
    }
    if (code === 'INVENTED_NUMERALS') {
      hint =
        `It contained numbers that are not in the KPI object or the input: ${(validationError.offending ?? []).join(', ')}. ` +
        'Remove them or replace them with figures that are supplied. Do not compute new numbers.';
    }
    if (code === 'CLAIM_RULES' && Array.isArray(validationError.offending)) {
      hint += ` Problems: ${validationError.offending.map((o) => `${o.where} -> ${o.code} (${o.detail})`).join('; ')}.`;
    }
    lines.push('', `Your previous reply was rejected (${code}). ${hint}`);
    if (typeof validationError.message === 'string' && code === 'SCHEMA_INVALID') {
      lines.push(`Validation detail: ${validationError.message.slice(0, 300)}`);
    }
    if (previousReply) {
      const cleaned = String(previousReply).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
      lines.push('Previous reply (for reference):', cleaned.slice(0, 3000));
    }
    lines.push('Return the corrected JSON object only.');
  }
  return lines.join('\n');
}

const SCHEMAS = {
  supervisor_daily_summary: `{
  "locale": "en|ar",
  "headline": "string",
  "summary": ["string", "string", "string"],   // 3 to 5 items
  "attention": [{"type":"string","text":"string","refs":["label"]}],
  "recommendedActions": ["string"],   // at most 3 items
  "kpis": {}
}`,
  sales_performance: `{
  "locale": "en|ar",
  "ranking": ["label", "label"],
  "trends": ["string"],
  "anomalies": ["string"],
  "recommendedActions": ["string"],
  "kpis": {}
}`,
  campaign_insights: `{
  "locale": "en|ar",
  "narrative": "string",
  "risks": [{"severity":"low|medium|high","text":"string","evidence":["label"]}],
  "opportunities": ["string"],
  "decisions": ["string"],
  "kpis": {}
}`,
  animateur_coaching: `{
  "locale": "en|ar",
  "coaching": [{"label":"A1","strengths":["string"],"gaps":["string"],"actions":["string"],"evidenceRefs":["label"]}],
  "campaignActions": ["string"],
  "kpis": {}
}`,
};

const CAPABILITY_DEFS = {
  supervisor_daily_summary: {
    id: 'supervisor_daily_summary',
    subjects: ['supervisor'],
    computeKpis: supervisorDailyKpis,
    fallback: (locale, kpis, ranking = [], findings = []) => buildFallback('supervisor_daily_summary', locale, kpis, ranking, findings),
    buildPrompt: (args) => ({
      system: selectSystem(args, 'supervisor_daily_summary'),
      user: userPrompt(args),
    }),
  },
  sales_performance: {
    id: 'sales_performance',
    subjects: ['campaign'],
    computeKpis: salesPerformanceKpis,
    computeRanking,
    fallback: (locale, kpis, ranking = [], findings = []) => buildFallback('sales_performance', locale, kpis, ranking, findings),
    buildPrompt: (args) => ({
      system: selectSystem(args, 'sales_performance'),
      user: userPrompt(args),
    }),
  },
  campaign_insights: {
    id: 'campaign_insights',
    subjects: ['campaign'],
    computeKpis: campaignInsightsKpis,
    fallback: (locale, kpis, ranking = [], findings = []) => buildFallback('campaign_insights', locale, kpis, ranking, findings),
    buildPrompt: (args) => ({
      system: selectSystem(args, 'campaign_insights'),
      user: userPrompt(args),
    }),
  },
  animateur_coaching: {
    id: 'animateur_coaching',
    subjects: ['campaign'],
    computeKpis: animateurCoachingKpis,
    fallback: (locale, kpis, ranking = [], findings = []) => buildFallback('animateur_coaching', locale, kpis, ranking, findings),
    buildPrompt: (args) => ({
      system: selectSystem(args, 'animateur_coaching'),
      user: userPrompt(args),
    }),
  },
};

export function getCapability(id) {
  return CAPABILITY_DEFS[id] ?? null;
}

export function allCapabilities() {
  return Object.values(CAPABILITY_DEFS);
}

export { computeCompleteness };
