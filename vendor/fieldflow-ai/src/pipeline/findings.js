import { DQ_MEANING } from './data-quality.js';

// Business-insight detection: deterministic, ranked FINDINGS computed from the
// request data. Code decides WHAT is notable; the model only explains it.
//
// No business threshold is invented. Every finding is a direct comparison that
// follows from the definitions: a value against its own target (100%), against
// the previous period, against its plan, or the highest / lowest of a group.
//
// Findings that depend on data the profile flagged as impossible are not
// emitted (they would be built on contradictory figures); the data problem is
// emitted instead as a DATA_ISSUE finding.
//
// Priority (rank) = polarity group, then relative size of the gap:
//   1. data conflicts  2. adverse findings, largest relative shortfall first
//   3. missing-data    4. info            5. positive / neutral
// "Relative size" is the shortfall as a fraction of the finding's own
// reference (target, plan, expected, previous). It is a proposal to confirm
// with the business, not an absolute severity.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const r3 = (x) => Math.round(x * 1000) / 1000;
const arr = (v) => (Array.isArray(v) ? v : []);
const abs3 = (n) => String(r3(Math.abs(n)));
const pct1 = (rateValue) => String(r3(rateValue * 100));

const duplicated = (rows) => {
  const labels = rows.map((x) => String(x?.label));
  return new Set(labels).size !== labels.length;
};

function uniqueExtreme(rows, metric, which) {
  const xs = rows.filter((r) => isNum(r[metric]));
  if (xs.length < 2) return null;
  const values = xs.map((r) => r[metric]);
  const target = which === 'max' ? Math.max(...values) : Math.min(...values);
  const hits = xs.filter((r) => r[metric] === target);
  return hits.length === 1 && new Set(values).size > 1 ? hits[0] : null;
}

// Labels of the entities a data problem concerns (so a claim may name them when citing the issue).
function affectedLabels(capability, data, code) {
  const key = capability === 'sales_performance' ? 'sellers' : capability === 'animateur_coaching' ? 'animateurs' : null;
  const rows = key ? arr(data[key]).filter((r) => r && typeof r === 'object') : [];
  const labels = (pred) => [...new Set(rows.filter(pred).map((r) => String(r.label)))];
  const fields = capability === 'animateur_coaching' ? ['units', 'attendanceRate', 'visits'] : ['units'];
  const numeric = ['units', 'target', 'attendanceRate', 'visits'];
  switch (code) {
    case 'DUPLICATE_LABEL': return labels((r) => rows.filter((x) => String(x.label) === String(r.label)).length > 1);
    case 'TARGET_MISSING': return labels((r) => !isNum(r.target));
    case 'TARGET_ZERO': return labels((r) => r.target === 0);
    case 'FIELD_MISSING': return labels((r) => fields.some((k) => !isNum(r[k])));
    case 'NEGATIVE_VALUE': return labels((r) => numeric.some((k) => isNum(r[k]) && r[k] < 0));
    case 'RATE_OUT_OF_RANGE': return labels((r) => isNum(r.attendanceRate) && (r.attendanceRate > 1 || r.attendanceRate < 0));
    case 'NONNUMERIC': return labels((r) => numeric.some((k) => r[k] != null && !isNum(r[k])));
    default: return [];
  }
}

function groupDetectors(capability, data) {
  const out = [];
  const a = data.attendance ?? {};
  const s = data.sales ?? {};
  const g = data.gifts ?? {};

  // attendance
  if (isNum(a.present) && isNum(a.expected) && a.expected > 0 && a.present >= 0 && a.present <= a.expected) {
    const missing = r3(a.expected - a.present);
    const rate = r3(a.present / a.expected);
    if (missing > 0) {
      out.push({ type: 'ATTENDANCE_GAP', polarity: 'adverse', magnitude: missing / a.expected, metrics: ['attendanceRate', capability === 'campaign_insights' ? 'attendanceGap' : 'missingCount'], values: { present: a.present, expected: a.expected, missingCount: missing, missingPct: r3((missing / a.expected) * 100), attendanceRate: rate } });
    } else {
      out.push({ type: 'ATTENDANCE_FULL', polarity: 'positive', magnitude: 0, metrics: ['attendanceRate'], values: { present: a.present, expected: a.expected, attendanceRate: rate } });
    }
  }

  // gifts
  if (isNum(g.planned) && g.planned > 0 && isNum(g.distributed) && g.distributed >= 0 && g.distributed <= g.planned) {
    const gap = r3(g.planned - g.distributed);
    if (gap > 0) {
      out.push({ type: 'GIFTS_UNDISTRIBUTED', polarity: 'adverse', magnitude: gap / g.planned, metrics: ['giftGap', 'giftDistributionRate'], values: { distributed: g.distributed, planned: g.planned, giftGap: gap, giftDistributionRate: r3(g.distributed / g.planned), giftRemainingPct: r3((gap / g.planned) * 100) } });
    } else {
      out.push({ type: 'GIFTS_COMPLETE', polarity: 'positive', magnitude: 0, metrics: ['giftDistributionRate'], values: { distributed: g.distributed, planned: g.planned, giftDistributionRate: 1 } });
    }
  }

  if (capability === 'supervisor_daily_summary' && isNum(s.units) && s.units >= 0 && isNum(s.previousUnits) && s.previousUnits > 0) {
    const delta = r3(((s.units - s.previousUnits) / s.previousUnits) * 100);
    const base = { metrics: ['unitsDeltaPct', 'units'], values: { units: s.units, previousUnits: s.previousUnits, unitsDeltaPct: delta } };
    if (delta < 0) out.push({ type: 'SALES_DECLINE', polarity: 'adverse', magnitude: Math.abs(delta) / 100, ...base });
    else if (delta > 0) out.push({ type: 'SALES_GROWTH', polarity: 'positive', magnitude: delta / 100, ...base });
    else out.push({ type: 'SALES_FLAT', polarity: 'neutral', magnitude: 0, ...base });
  }

  if (capability === 'campaign_insights' && isNum(s.units) && s.units >= 0 && isNum(s.target) && s.target > 0) {
    const gap = r3(s.target - s.units);
    const base = { metrics: ['targetGap', 'targetAttainmentPct'], values: { units: s.units, target: s.target, targetGap: gap, targetAttainmentPct: r3((s.units / s.target) * 100), targetShortfallPct: r3((gap / s.target) * 100) } };
    if (gap > 0) out.push({ type: 'SALES_TARGET_SHORTFALL', polarity: 'adverse', magnitude: gap / s.target, ...base });
    else if (gap < 0) out.push({ type: 'SALES_TARGET_EXCEEDED', polarity: 'positive', magnitude: -gap / s.target, ...base });
    else out.push({ type: 'SALES_TARGET_MET', polarity: 'neutral', magnitude: 0, ...base });
  }
  return out.map((f) => ({ scope: 'group', entity: null, ...f }));
}

function targetFinding(row, kindMetrics) {
  const gap = r3(row.target - row.units);
  const values = { units: row.units, target: row.target, gapToTarget: gap, attainmentPct: r3((row.units / row.target) * 100) };
  const base = { scope: 'entity', entity: row.label, metrics: kindMetrics, values };
  if (gap > 0) return { type: 'TARGET_BELOW', polarity: 'adverse', magnitude: gap / row.target, ...base };
  if (gap < 0) return { type: 'TARGET_ABOVE', polarity: 'positive', magnitude: -gap / row.target, ...base };
  return { type: 'TARGET_MET', polarity: 'neutral', magnitude: 0, ...base };
}

// A lowest-in-group finding is relative, not an absolute problem, so it is NOT adverse (no forced
// coverage, ranked with the neutral findings). `lean: 'weak'` only tells the renderer to list it
// among gaps, never among strengths.
function extremeFinding(row, type, metric, valueKey, value) {
  return { type, scope: 'entity', entity: row.label, polarity: 'neutral', ...(type.startsWith('LOWEST_') ? { lean: 'weak' } : {}), magnitude: 0, metrics: [metric], values: { [valueKey]: value } };
}

function entityDetectors(capability, data) {
  const out = [];
  const key = capability === 'sales_performance' ? 'sellers' : 'animateurs';
  const rows = arr(data[key]).filter((r) => r && typeof r === 'object');
  if (rows.length === 0 || duplicated(rows)) return out; // duplicated labels make per-entity statements ambiguous
  const ok = rows.map((r) => ({
    label: String(r.label),
    units: isNum(r.units) && r.units >= 0 ? r.units : null,
    target: isNum(r.target) && r.target > 0 ? r.target : null,
    attendanceRate: isNum(r.attendanceRate) && r.attendanceRate >= 0 && r.attendanceRate <= 1 ? r.attendanceRate : null,
    visits: isNum(r.visits) && r.visits >= 0 ? r.visits : null,
  }));
  for (const r of ok) {
    if (r.units !== null && r.target !== null) {
      out.push(targetFinding(r, ['units', 'target', 'gapToTarget']));
      r.attainmentPct = r3((r.units / r.target) * 100);
    }
  }
  const emit = (metric, type, which, valueKey, metricName, fmt = (v) => v) => {
    const hit = uniqueExtreme(ok, metric, which);
    if (hit) out.push(extremeFinding(hit, type, metricName, valueKey, fmt(hit[metric])));
  };
  emit('units', 'HIGHEST_UNITS', 'max', 'units', 'units');
  emit('units', 'LOWEST_UNITS', 'min', 'units', 'units');
  emit('attainmentPct', 'HIGHEST_ATTAINMENT', 'max', 'attainmentPct', 'attainmentPct');
  emit('attainmentPct', 'LOWEST_ATTAINMENT', 'min', 'attainmentPct', 'attainmentPct');
  if (capability === 'animateur_coaching') {
    emit('attendanceRate', 'HIGHEST_ATTENDANCE', 'max', 'attendanceRate', 'attendanceRate');
    emit('attendanceRate', 'LOWEST_ATTENDANCE', 'min', 'attendanceRate', 'attendanceRate');
    emit('visits', 'HIGHEST_VISITS', 'max', 'visits', 'visits');
    emit('visits', 'LOWEST_VISITS', 'min', 'visits', 'visits');
  }
  return out;
}

// Explicit causal evidence supplied by the backend: data.causes = [{ label?: 'S2', code: 'STK-01' }].
// The code is OPAQUE: the service does not know what it means and never interprets it. It only
// records that the data states a cause for this entity, which is the one thing that allows a
// report to state a cause as a fact (by citing this finding). Causes for unknown labels are ignored.
function causeDetectors(capability, data) {
  const entityKey = capability === 'sales_performance' ? 'sellers' : capability === 'animateur_coaching' ? 'animateurs' : null;
  const known = new Set((entityKey ? arr(data[entityKey]) : []).map((r) => String(r?.label)));
  const out = [];
  for (const c of arr(data.causes)) {
    if (!c || typeof c !== 'object' || typeof c.code !== 'string' || c.code.length === 0) continue;
    const label = typeof c.label === 'string' && c.label.length > 0 ? c.label : null;
    if (label && !known.has(label)) continue;
    out.push({ type: 'KNOWN_CAUSE', scope: label ? 'entity' : 'group', entity: label, polarity: 'cause', code: c.code, magnitude: 0, metrics: [], values: {} });
  }
  return out;
}

function periodDetectors(data) {
  const out = [];
  const periods = arr(data.periods).filter((p) => p && typeof p === 'object');
  if (periods.length < 2 || duplicated(periods) || periods.some((p) => !isNum(p.units) || p.units < 0)) return out;
  const changes = [];
  periods.forEach((p, i) => {
    if (i === 0) return;
    const prev = periods[i - 1];
    const change = r3(p.units - prev.units);
    changes.push(change);
    if (change === 0) return;
    const values = { units: p.units, previousUnits: prev.units, changeUnits: change };
    if (prev.units > 0) values.changePct = r3((change / prev.units) * 100);
    out.push({
      type: change < 0 ? 'PERIOD_DECLINE' : 'PERIOD_INCREASE', scope: 'entity', entity: String(p.label),
      polarity: change < 0 ? 'adverse' : 'positive', magnitude: prev.units > 0 ? Math.abs(change) / prev.units : 0,
      metrics: ['units', 'changeUnits'], values, related: [String(prev.label)],
    });
  });
  if (changes.length >= 2 && changes.every((c) => c < 0)) {
    out.push({ type: 'SUSTAINED_DECLINE', scope: 'group', entity: null, polarity: 'adverse', magnitude: 0, metrics: ['periods'], values: { periods: periods.length } });
  } else if (changes.length >= 2 && changes.every((c) => c > 0)) {
    out.push({ type: 'SUSTAINED_GROWTH', scope: 'group', entity: null, polarity: 'positive', magnitude: 0, metrics: ['periods'], values: { periods: periods.length } });
  }
  return out;
}

const GROUP_ORDER = { dataConflict: 0, adverse: 1, cause: 2, dataMissing: 3, dataInfo: 4, other: 5 };
const groupOf = (f) => {
  if (f.polarity === 'cause') return 'cause';
  if (f.polarity === 'data') return f.severity === 'conflict' ? 'dataConflict' : f.severity === 'missing' ? 'dataMissing' : 'dataInfo';
  return f.polarity === 'adverse' ? 'adverse' : 'other';
};

// `dq` = profileData() findings. Returns ranked findings with ids F1..Fn.
export function detectFindings(capability, data = {}, dq = []) {
  const d = data ?? {};
  const found = [];
  if (capability === 'supervisor_daily_summary' || capability === 'campaign_insights') found.push(...groupDetectors(capability, d));
  if (capability === 'sales_performance' || capability === 'animateur_coaching') found.push(...entityDetectors(capability, d));
  if (capability === 'sales_performance') found.push(...periodDetectors(d));
  found.push(...causeDetectors(capability, d));
  for (const f of dq) {
    found.push({ type: 'DATA_ISSUE', scope: 'group', entity: null, polarity: 'data', severity: f.severity, code: f.code, magnitude: 0, metrics: [], values: {}, related: affectedLabels(capability, d, f.code) });
  }
  return found
    .map((f, i) => ({ f, i }))
    .sort((x, y) => GROUP_ORDER[groupOf(x.f)] - GROUP_ORDER[groupOf(y.f)] || y.f.magnitude - x.f.magnitude || x.i - y.i)
    .map(({ f }, idx) => ({ id: `F${idx + 1}`, rank: idx + 1, ...f }));
}

// What a finding is about, for tests and refs: entity label, or a topic.
export function findingTopic(f) {
  if (f.entity) return f.entity;
  if (f.type.startsWith('ATTENDANCE')) return 'attendance';
  if (f.type.startsWith('GIFTS')) return 'gifts';
  if (f.type.startsWith('SALES') || f.type === 'SUSTAINED_DECLINE' || f.type === 'SUSTAINED_GROWTH') return 'sales';
  return f.type === 'DATA_ISSUE' ? 'data' : null;
}

// Evidence references for a finding: its entity, else its metrics, else its data code.
export const findingRefs = (f) => (f.entity ? [f.entity] : f.metrics.length > 0 ? f.metrics.slice(0, 2) : f.code ? [f.code] : []);

// Public, compact form returned in output.insights.
export const publicFinding = (f) => ({
  id: f.id, type: f.type, scope: f.scope, entity: f.entity, polarity: f.polarity, rank: f.rank,
  ...(f.lean ? { lean: f.lean } : {}),
  ...(f.code ? { code: f.code, ...(f.severity ? { severity: f.severity } : {}) } : {}), values: f.values,
});

// ---- deterministic, bilingual statement of a finding (fallback + coverage) ----
const S = {
  en: {
    TARGET_BELOW: (f) => `${f.entity} sold ${f.values.units} units against a target of ${f.values.target}, ${abs3(f.values.gapToTarget)} below target (${f.values.attainmentPct} percent attainment).`,
    TARGET_ABOVE: (f) => `${f.entity} sold ${f.values.units} units against a target of ${f.values.target}, exceeding it by ${abs3(f.values.gapToTarget)} (${f.values.attainmentPct} percent attainment).`,
    TARGET_MET: (f) => `${f.entity} reached its target of ${f.values.target} with ${f.values.units} units.`,
    HIGHEST_UNITS: (f) => `${f.entity} has the highest units: ${f.values.units}.`,
    LOWEST_UNITS: (f) => `${f.entity} has the lowest units: ${f.values.units}.`,
    HIGHEST_ATTAINMENT: (f) => `${f.entity} has the highest attainment: ${f.values.attainmentPct} percent.`,
    LOWEST_ATTAINMENT: (f) => `${f.entity} has the lowest attainment: ${f.values.attainmentPct} percent.`,
    HIGHEST_ATTENDANCE: (f) => `${f.entity} has the highest attendance rate: ${pct1(f.values.attendanceRate)} percent.`,
    LOWEST_ATTENDANCE: (f) => `${f.entity} has the lowest attendance rate: ${pct1(f.values.attendanceRate)} percent.`,
    HIGHEST_VISITS: (f) => `${f.entity} has the most visits: ${f.values.visits}.`,
    LOWEST_VISITS: (f) => `${f.entity} has the fewest visits: ${f.values.visits}.`,
    PERIOD_DECLINE: (f) => `Units in ${f.entity} fell by ${abs3(f.values.changeUnits)} to ${f.values.units} from ${f.values.previousUnits}.`,
    PERIOD_INCREASE: (f) => `Units in ${f.entity} rose by ${abs3(f.values.changeUnits)} to ${f.values.units} from ${f.values.previousUnits}.`,
    SUSTAINED_DECLINE: () => 'Units fell in every consecutive period.',
    SUSTAINED_GROWTH: () => 'Units rose in every consecutive period.',
    ATTENDANCE_GAP: (f) => `Attendance is ${pct1(f.values.attendanceRate)} percent: ${f.values.present} present out of ${f.values.expected} expected, ${f.values.missingCount} missing.`,
    ATTENDANCE_FULL: (f) => `All ${f.values.expected} expected attendees were present.`,
    GIFTS_UNDISTRIBUTED: (f) => `${f.values.distributed} of ${f.values.planned} planned gifts were distributed; ${f.values.giftGap} remain (${f.values.giftRemainingPct} percent).`,
    GIFTS_COMPLETE: (f) => `All ${f.values.planned} planned gifts were distributed.`,
    SALES_DECLINE: (f) => `Sales fell to ${f.values.units} units from ${f.values.previousUnits}, down ${abs3(f.values.unitsDeltaPct)} percent.`,
    SALES_GROWTH: (f) => `Sales rose to ${f.values.units} units from ${f.values.previousUnits}, up ${abs3(f.values.unitsDeltaPct)} percent.`,
    SALES_FLAT: (f) => `Sales are unchanged at ${f.values.units} units.`,
    SALES_TARGET_SHORTFALL: (f) => `Sales reached ${f.values.units} units against a target of ${f.values.target}, a shortfall of ${f.values.targetGap} (${f.values.targetShortfallPct} percent).`,
    SALES_TARGET_EXCEEDED: (f) => `Sales reached ${f.values.units} units against a target of ${f.values.target}, exceeding it by ${abs3(f.values.targetGap)}.`,
    SALES_TARGET_MET: (f) => `Sales reached the target of ${f.values.target} units.`,
  },
  ar: {
    TARGET_BELOW: (f) => `حقق ${f.entity} ${f.values.units} وحدة مقابل هدف ${f.values.target}، أي أقل من الهدف بـ ${abs3(f.values.gapToTarget)} (${f.values.attainmentPct} بالمئة).`,
    TARGET_ABOVE: (f) => `حقق ${f.entity} ${f.values.units} وحدة مقابل هدف ${f.values.target}، متجاوزاً الهدف بـ ${abs3(f.values.gapToTarget)} (${f.values.attainmentPct} بالمئة).`,
    TARGET_MET: (f) => `بلغ ${f.entity} هدفه ${f.values.target} بتحقيق ${f.values.units} وحدة.`,
    HIGHEST_UNITS: (f) => `${f.entity} الأعلى مبيعاً: ${f.values.units} وحدة.`,
    LOWEST_UNITS: (f) => `${f.entity} الأدنى مبيعاً: ${f.values.units} وحدة.`,
    HIGHEST_ATTAINMENT: (f) => `${f.entity} الأعلى في نسبة التحقق: ${f.values.attainmentPct} بالمئة.`,
    LOWEST_ATTAINMENT: (f) => `${f.entity} الأدنى في نسبة التحقق: ${f.values.attainmentPct} بالمئة.`,
    HIGHEST_ATTENDANCE: (f) => `${f.entity} الأعلى في نسبة الحضور: ${pct1(f.values.attendanceRate)} بالمئة.`,
    LOWEST_ATTENDANCE: (f) => `${f.entity} الأدنى في نسبة الحضور: ${pct1(f.values.attendanceRate)} بالمئة.`,
    HIGHEST_VISITS: (f) => `${f.entity} الأكثر زيارات: ${f.values.visits}.`,
    LOWEST_VISITS: (f) => `${f.entity} الأقل زيارات: ${f.values.visits}.`,
    PERIOD_DECLINE: (f) => `انخفضت الوحدات في ${f.entity} بمقدار ${abs3(f.values.changeUnits)} لتبلغ ${f.values.units} بعد ${f.values.previousUnits}.`,
    PERIOD_INCREASE: (f) => `ارتفعت الوحدات في ${f.entity} بمقدار ${abs3(f.values.changeUnits)} لتبلغ ${f.values.units} بعد ${f.values.previousUnits}.`,
    SUSTAINED_DECLINE: () => 'انخفضت الوحدات في كل فترة متتالية.',
    SUSTAINED_GROWTH: () => 'ارتفعت الوحدات في كل فترة متتالية.',
    ATTENDANCE_GAP: (f) => `الحضور ${pct1(f.values.attendanceRate)} بالمئة: حضر ${f.values.present} من أصل ${f.values.expected} متوقع وغاب ${f.values.missingCount}.`,
    ATTENDANCE_FULL: (f) => `حضر جميع المتوقعين وعددهم ${f.values.expected}.`,
    GIFTS_UNDISTRIBUTED: (f) => `وُزعت ${f.values.distributed} هدية من أصل ${f.values.planned} مخطط، وتبقى ${f.values.giftGap} (${f.values.giftRemainingPct} بالمئة).`,
    GIFTS_COMPLETE: (f) => `وُزعت جميع الهدايا المخططة وعددها ${f.values.planned}.`,
    SALES_DECLINE: (f) => `انخفضت المبيعات إلى ${f.values.units} وحدة من ${f.values.previousUnits}، بنسبة ${abs3(f.values.unitsDeltaPct)} بالمئة.`,
    SALES_GROWTH: (f) => `ارتفعت المبيعات إلى ${f.values.units} وحدة من ${f.values.previousUnits}، بنسبة ${abs3(f.values.unitsDeltaPct)} بالمئة.`,
    SALES_FLAT: (f) => `المبيعات ثابتة عند ${f.values.units} وحدة.`,
    SALES_TARGET_SHORTFALL: (f) => `بلغت المبيعات ${f.values.units} وحدة مقابل هدف ${f.values.target}، بعجز ${f.values.targetGap} (${f.values.targetShortfallPct} بالمئة).`,
    SALES_TARGET_EXCEEDED: (f) => `بلغت المبيعات ${f.values.units} وحدة مقابل هدف ${f.values.target}، متجاوزة الهدف بـ ${abs3(f.values.targetGap)}.`,
    SALES_TARGET_MET: (f) => `بلغت المبيعات هدف ${f.values.target} وحدة.`,
  },
};

export function renderFinding(f, locale) {
  const lang = locale === 'ar' ? 'ar' : 'en';
  if (f.type === 'KNOWN_CAUSE') {
    return lang === 'en'
      ? `The data reports cause code ${f.code}${f.entity ? ` for ${f.entity}` : ''}.`
      : `تفيد البيانات بوجود سبب برمز ${f.code}${f.entity ? ` لـ ${f.entity}` : ''}.`;
  }
  if (f.type === 'DATA_ISSUE') {
    const text = DQ_MEANING[f.code]?.[lang] ?? '';
    return lang === 'en' ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : `${text}.`;
  }
  return S[lang][f.type](f);
}

// A neutral recommendation that follows directly from a finding: "review it". It states no cause, no figure and
// no new fact, so the code can use it when the model's own recommendation had to be removed (D9).
const R = {
  en: {
    TARGET_BELOW: (f) => `Review the performance of ${f.entity} against its target.`,
    PERIOD_DECLINE: (f) => `Review the decline in ${f.entity}.`,
    SUSTAINED_DECLINE: () => 'Review the sustained decline across periods.',
    ATTENDANCE_GAP: () => 'Review the attendance gap.',
    GIFTS_UNDISTRIBUTED: () => 'Review the distribution of the remaining gifts.',
    SALES_DECLINE: () => 'Review the drop in sales.',
    SALES_TARGET_SHORTFALL: () => 'Review the sales gap to target.',
    DATA_ISSUE: () => 'Verify the source data.',
  },
  ar: {
    TARGET_BELOW: (f) => `مراجعة أداء ${f.entity} مقارنة بهدفه.`,
    PERIOD_DECLINE: (f) => `مراجعة الانخفاض في ${f.entity}.`,
    SUSTAINED_DECLINE: () => 'مراجعة الانخفاض المستمر عبر الفترات.',
    ATTENDANCE_GAP: () => 'مراجعة فجوة الحضور.',
    GIFTS_UNDISTRIBUTED: () => 'مراجعة توزيع الهدايا المتبقية.',
    SALES_DECLINE: () => 'مراجعة انخفاض المبيعات.',
    SALES_TARGET_SHORTFALL: () => 'مراجعة فجوة المبيعات عن الهدف.',
    DATA_ISSUE: () => 'التحقق من البيانات المصدر.',
  },
};

export function renderRecommendation(f, locale) {
  const fn = R[locale === 'ar' ? 'ar' : 'en'][f.type];
  return fn ? fn(f) : null;
}

// Every number a finding may put in prose (added to the numeric allow-list).
export const findingNumbers = (findings) => findings.map((f) => f.values);
