// Pure builders of the aggregate payloads sent to the AI service (HANDOFF §4.2). They map the
// reporting service's KPI objects (the dashboard's numbers) to `input.context.data` and hand back
// the label → id map that stays on our side. Only counts, rates and short codes (A1, S1, P1)
// leave the backend; a missing target is omitted, never sent as null.
import {
  AI_SUBJECT_TYPES,
  ERROR_CODES,
  aiServiceRequestSchema,
  findPiiProblems,
} from '@fieldflow/shared';

export class AiPayloadError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'AiPayloadError';
    this.code = code;
  }
}

const DAY = 86_400_000;
const round3 = (value) => Math.round(value * 1000) / 1000;
const number = (value) => Number(value ?? 0);
const present = (kpis) => ({
  present: number(kpis.attendance.verified) + number(kpis.attendance.pending),
  expected: number(kpis.attendance.expectedSlots),
});
const gifts = (kpis) => ({
  distributed: number(kpis.gifts.distributedUnits),
  planned: number(kpis.gifts.entitledUnits),
});
const targetOf = (kpis) => kpis.completion?.salesTarget ?? null;
const optional = (key, value) => (value == null ? {} : { [key]: value });

/** Whether the period has a sales target (from the campaign's sales_target rule). */
export const hasSalesTarget = (kpis) => targetOf(kpis) != null;

function requireTarget(kpis) {
  if (!hasSalesTarget(kpis))
    throw new AiPayloadError(ERROR_CODES.AI_TARGET_REQUIRED, 'The period has no sales target');
}

/**
 * Gives every row a label `prefix1…prefixN`. Labels already in `existing` (label → id, stored by an
 * earlier attempt of the same request) are kept, so a retry never renames anybody; new ids take the
 * next free number. The same entity has the same label inside one request only.
 * @template {{ id: string }} T
 * @param {T[]} rows rows in the order new labels are handed out
 * @param {string} prefix
 * @param {Record<string, string>} existing
 * @returns {Array<T & { label: string }>}
 */
function assignLabels(rows, prefix, existing) {
  const known = new Map(Object.entries(existing).map(([label, id]) => [id, label]));
  const used = new Set(known.values());
  let next = 1;
  return rows.map((row) => {
    let label = known.get(row.id);
    if (!label) {
      while (used.has(`${prefix}${next}`)) next += 1;
      label = `${prefix}${next}`;
      used.add(label);
    }
    return { ...row, label };
  });
}

const byUnits = (a, b) => b.units - a.units || a.id.localeCompare(b.id);
const toMap = (rows) => Object.fromEntries(rows.map(({ label, id }) => [label, id]));
const monday = (date) => {
  const time = Date.parse(date);
  return new Date(time - ((new Date(time).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
};

/** Days (or Monday-start weeks above 31 days) in ascending order, with their units. */
function periodBuckets(daily) {
  const days = daily.filter((row) => row.id).sort((a, b) => a.id.localeCompare(b.id));
  const buckets = new Map();
  for (const row of days) {
    const key = days.length > 31 ? monday(row.id) : row.id;
    buckets.set(key, (buckets.get(key) ?? 0) + number(row.sales.units));
  }
  return [...buckets].map(([id, units]) => ({ id, units }));
}

/**
 * @param {{ today: object, previous: object }} input KPIs of the work date and of the same weekday
 *   one week earlier (a fixed choice: the previous calendar day is often a day off).
 */
export function supervisorDailySummary({ today, previous }) {
  return {
    data: {
      attendance: present(today),
      sales: { units: number(today.sales.units), previousUnits: number(previous.sales.units) },
      gifts: gifts(today),
    },
    labelMap: {},
  };
}

/** @param {{ total: object, animateurs: object[], daily: object[], existing?: Record<string,string> }} input */
export function salesPerformance({ total, animateurs, daily, existing = {} }) {
  requireTarget(total);
  const sellers = assignLabels(
    animateurs
      .filter((row) => row.id)
      .map((row) => ({ id: row.id, units: number(row.sales.units), target: targetOf(row) }))
      .sort(byUnits),
    'S',
    existing,
  );
  const periods = assignLabels(periodBuckets(daily), 'P', existing);
  return {
    data: {
      sellers: sellers.map(({ label, units, target }) => ({
        label,
        units,
        ...optional('target', target),
      })),
      periods: periods.map(({ label, units }) => ({ label, units })),
    },
    labelMap: { ...toMap(sellers), ...toMap(periods) },
  };
}

/** @param {{ total: object }} input */
export function campaignInsights({ total }) {
  requireTarget(total);
  return {
    data: {
      attendance: present(total),
      sales: { units: number(total.sales.units), target: targetOf(total) },
      gifts: gifts(total),
    },
    labelMap: {},
  };
}

/** @param {{ animateurs: object[], existing?: Record<string,string> }} input */
export function animateurCoaching({ animateurs, existing = {} }) {
  const rows = assignLabels(
    animateurs
      .filter((row) => row.id)
      .filter(
        (row) =>
          number(row.attendance.expectedSlots) > 0 ||
          number(row.sales.units) > 0 ||
          number(row.visits.count) > 0,
      )
      .map((row) => ({
        id: row.id,
        units: number(row.sales.units),
        rate: row.attendance.rate,
        target: targetOf(row),
        visits: number(row.visits.count),
      }))
      .sort(byUnits),
    'A',
    existing,
  );
  return {
    data: {
      animateurs: rows.map(({ label, rate, units, target, visits }) => ({
        label,
        ...optional('attendanceRate', rate == null ? null : round3(rate)),
        units,
        ...optional('target', target),
        visits,
      })),
    },
    labelMap: toMap(rows),
  };
}

export const payloadBuilders = Object.freeze({
  supervisor_daily_summary: supervisorDailySummary,
  sales_performance: salesPerformance,
  campaign_insights: campaignInsights,
  animateur_coaching: animateurCoaching,
});

/**
 * The full request body for `POST /v1/{capability}`.
 * @param {{ capability: string, requestId: string, agencyId: string, subjectId: string,
 *   locale: 'ar' | 'en', context: { workDate?: string, from?: string, to?: string }, data: object }} input
 */
export function assemblePayload({
  capability,
  requestId,
  agencyId,
  subjectId,
  locale,
  context,
  data,
}) {
  return {
    requestId,
    agencyId,
    subject: { type: AI_SUBJECT_TYPES[capability], id: subjectId },
    input: { text: null, fileUrl: null, context: { ...context, locale, data } },
  };
}

/**
 * Last check before anything leaves the backend: the contract schema, the subject type of the
 * capability and the PII guard on `data`. A failure is a bug in a builder, never a user error.
 * @returns {object} the validated body
 */
export function validatePayload(capability, body) {
  const parsed = aiServiceRequestSchema.safeParse(body);
  if (!parsed.success)
    throw new AiPayloadError(
      'AI_PAYLOAD_INVALID',
      `Payload does not match the AI contract: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  if (parsed.data.subject.type !== AI_SUBJECT_TYPES[capability])
    throw new AiPayloadError('AI_PAYLOAD_INVALID', 'Wrong subject type for the capability');
  const problems = findPiiProblems(parsed.data.input.context.data);
  if (problems.length)
    throw new AiPayloadError('AI_PII_GUARD', `PII guard rejected: ${problems.join('; ')}`);
  return parsed.data;
}
