// Independent reference calculator for the offline benchmark.
//
// It is written from the metric DEFINITIONS (see eval/README.md), NOT from
// src/pipeline/kpis.js, and it must never import from src/. A test enforces
// this. Where the service and this file disagree, the benchmark reports it.
//
// Semantics that differ on purpose from the service:
//   * A metric is `null` (undefined) when any input it needs is missing or its
//     denominator is 0. The service reports 0 in those cases.
//   * An aggregate over several entities is `null` when any entity is missing
//     the field (no silent partial sums).
// Both are proposals pending business confirmation (see eval/README.md).

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const r3 = (x) => Math.round(x * 1000) / 1000;
const arr = (v) => (Array.isArray(v) ? v : []);
const div = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);
const sub = (a, b) => (isNum(a) && isNum(b) ? r3(a - b) : null);
const pct = (a, b) => { const q = div(a, b); return q === null ? null : r3(q * 100); };
const rate = (a, b) => { const q = div(a, b); return q === null ? null : r3(q); };
const sumAll = (xs) => (xs.length > 0 && xs.every(isNum) ? r3(xs.reduce((s, x) => s + x, 0)) : null);
const meanAll = (xs) => (xs.length > 0 && xs.every(isNum) ? r3(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const val = (v) => (isNum(v) ? v : null);

export function refKpis(cap, data = {}) {
  const a = data.attendance ?? {};
  const s = data.sales ?? {};
  const g = data.gifts ?? {};
  switch (cap) {
    case 'supervisor_daily_summary':
      return {
        presentCount: val(a.present),
        expectedCount: val(a.expected),
        missingCount: sub(a.expected, a.present),
        attendanceRate: rate(a.present, a.expected),
        units: val(s.units),
        previousUnits: val(s.previousUnits),
        unitsDeltaPct: pct(sub(s.units, s.previousUnits), s.previousUnits),
        distributedGifts: val(g.distributed),
        plannedGifts: val(g.planned),
        giftGap: sub(g.planned, g.distributed),
        giftDistributionRate: rate(g.distributed, g.planned),
      };
    case 'sales_performance': {
      const sellers = arr(data.sellers);
      const periods = arr(data.periods);
      const totalUnits = sumAll(sellers.map((x) => x?.units));
      const totalTarget = sumAll(sellers.map((x) => x?.target));
      const units = sellers.map((x) => x?.units);
      return {
        sellerCount: sellers.length,
        totalUnits,
        totalTarget,
        targetGap: sub(totalTarget, totalUnits),
        targetAttainmentPct: pct(totalUnits, totalTarget),
        topSellerUnits: units.length > 0 && units.every(isNum) ? Math.max(...units) : null,
        periodCount: periods.length,
        lastPeriodUnits: periods.length > 0 ? val(periods.at(-1)?.units) : null,
      };
    }
    case 'campaign_insights':
      return {
        attendanceRate: rate(a.present, a.expected),
        attendanceGap: sub(a.expected, a.present),
        units: val(s.units),
        target: val(s.target),
        targetGap: sub(s.target, s.units),
        targetAttainmentPct: pct(s.units, s.target),
        giftDistributionRate: rate(g.distributed, g.planned),
        giftGap: sub(g.planned, g.distributed),
        giftRemainingPct: pct(sub(g.planned, g.distributed), g.planned),
        targetShortfallPct: pct(sub(s.target, s.units), s.target),
      };
    case 'animateur_coaching': {
      const list = arr(data.animateurs);
      const totalUnits = sumAll(list.map((x) => x?.units));
      const totalTarget = sumAll(list.map((x) => x?.target));
      return {
        animateurCount: list.length,
        avgAttendanceRate: meanAll(list.map((x) => x?.attendanceRate)),
        totalUnits,
        totalTarget,
        targetGap: sub(totalTarget, totalUnits),
        attainmentPct: pct(totalUnits, totalTarget),
        avgVisits: meanAll(list.map((x) => x?.visits)),
      };
    }
    default:
      throw new Error(`unknown capability ${cap}`);
  }
}

const direction = (units, target) => {
  if (!isNum(units) || !isNum(target) || target <= 0) return null;
  if (units > target) return 'above';
  if (units < target) return 'below';
  return 'at';
};

// Per-entity rows (sellers, periods, animateurs) with the figures an analyst
// could legitimately quote for each one.
export function refRows(cap, data = {}) {
  const rows = [];
  if (cap === 'sales_performance') {
    for (const x of arr(data.sellers)) {
      rows.push({
        kind: 'seller', label: String(x?.label),
        units: val(x?.units), target: val(x?.target),
        gapToTarget: sub(x?.target, x?.units), attainmentPct: pct(x?.units, x?.target),
        direction: direction(x?.units, x?.target),
      });
    }
    const periods = arr(data.periods);
    periods.forEach((x, i) => {
      const prev = periods[i - 1];
      rows.push({
        kind: 'period', label: String(x?.label), units: val(x?.units), previousUnits: i > 0 ? val(prev?.units) : null,
        changeUnits: i > 0 ? sub(x?.units, prev?.units) : null,
        changePct: i > 0 ? pct(sub(x?.units, prev?.units), prev?.units) : null,
      });
    });
  }
  if (cap === 'animateur_coaching') {
    for (const x of arr(data.animateurs)) {
      rows.push({
        kind: 'animateur', label: String(x?.label),
        attendanceRate: val(x?.attendanceRate), units: val(x?.units), target: val(x?.target), visits: val(x?.visits),
        gapToTarget: sub(x?.target, x?.units), attainmentPct: pct(x?.units, x?.target),
        direction: direction(x?.units, x?.target),
      });
    }
  }
  return rows;
}

// Which labels are the best / worst on any supplied metric (ties included).
export function refExtremes(rows) {
  const top = new Set();
  const bottom = new Set();
  const people = rows.filter((r) => r.kind === 'seller' || r.kind === 'animateur');
  for (const metric of ['units', 'attainmentPct', 'attendanceRate', 'visits']) {
    const xs = people.filter((r) => isNum(r[metric]));
    if (xs.length < 2) continue;
    const hi = Math.max(...xs.map((r) => r[metric]));
    const lo = Math.min(...xs.map((r) => r[metric]));
    xs.forEach((r) => { if (r[metric] === hi) top.add(r.label); if (r[metric] === lo) bottom.add(r.label); });
  }
  return { top, bottom };
}

// Data-quality findings, by severity.
//   conflict : the data contradicts itself or is impossible; the report must say so
//   missing  : an input is absent or undefined; KPIs must be undefined, not 0
//   info     : worth knowing, not an error
export const DQ_SEVERITY = {
  PRESENT_GT_EXPECTED: 'conflict',
  NEGATIVE_VALUE: 'conflict',
  DISTRIBUTED_GT_PLANNED: 'conflict',
  DUPLICATE_LABEL: 'conflict',
  RATE_OUT_OF_RANGE: 'conflict',
  TARGET_ZERO: 'conflict',
  FIELD_MISSING: 'missing',
  TARGET_MISSING: 'missing',
  DENOMINATOR_ZERO: 'missing',
  PREVIOUS_ZERO: 'info',
  PERIODS_SELLERS_MISMATCH: 'info',
};

function anyNegative(v) {
  if (isNum(v)) return v < 0;
  if (Array.isArray(v)) return v.some(anyNegative);
  if (v && typeof v === 'object') return Object.values(v).some(anyNegative);
  return false;
}

function hasDuplicates(list) {
  const labels = list.map((x) => String(x?.label));
  return new Set(labels).size !== labels.length;
}

export function refDq(cap, data = {}) {
  const codes = new Set();
  const a = data.attendance ?? {};
  const s = data.sales ?? {};
  const g = data.gifts ?? {};
  if (anyNegative(data)) codes.add('NEGATIVE_VALUE');

  if (cap === 'supervisor_daily_summary' || cap === 'campaign_insights') {
    const required = cap === 'supervisor_daily_summary'
      ? [a.present, a.expected, s.units, s.previousUnits, g.distributed, g.planned]
      : [a.present, a.expected, s.units, g.distributed, g.planned];
    if (required.some((v) => !isNum(v))) codes.add('FIELD_MISSING');
    if (isNum(a.present) && isNum(a.expected) && a.present > a.expected) codes.add('PRESENT_GT_EXPECTED');
    if (a.expected === 0 || g.planned === 0) codes.add('DENOMINATOR_ZERO');
    if (isNum(g.distributed) && isNum(g.planned) && g.distributed > g.planned) codes.add('DISTRIBUTED_GT_PLANNED');
    if (cap === 'supervisor_daily_summary' && s.previousUnits === 0) codes.add('PREVIOUS_ZERO');
    if (cap === 'campaign_insights') {
      if (!isNum(s.target)) codes.add('TARGET_MISSING');
      if (s.target === 0) codes.add('TARGET_ZERO');
    }
  }

  if (cap === 'sales_performance') {
    const sellers = arr(data.sellers);
    const periods = arr(data.periods);
    if (hasDuplicates(sellers)) codes.add('DUPLICATE_LABEL');
    if (sellers.some((x) => !isNum(x?.units))) codes.add('FIELD_MISSING');
    if (sellers.some((x) => !isNum(x?.target))) codes.add('TARGET_MISSING');
    if (sellers.some((x) => x?.target === 0)) codes.add('TARGET_ZERO');
    const su = sumAll(sellers.map((x) => x?.units));
    const pu = sumAll(periods.map((x) => x?.units));
    if (su !== null && pu !== null && su !== pu) codes.add('PERIODS_SELLERS_MISMATCH');
  }

  if (cap === 'animateur_coaching') {
    const list = arr(data.animateurs);
    if (hasDuplicates(list)) codes.add('DUPLICATE_LABEL');
    if (list.some((x) => isNum(x?.attendanceRate) && (x.attendanceRate > 1 || x.attendanceRate < 0))) codes.add('RATE_OUT_OF_RANGE');
    if (list.some((x) => !isNum(x?.units) || !isNum(x?.visits) || !isNum(x?.attendanceRate))) codes.add('FIELD_MISSING');
    if (list.some((x) => !isNum(x?.target))) codes.add('TARGET_MISSING');
    if (list.some((x) => x?.target === 0)) codes.add('TARGET_ZERO');
  }

  return [...codes].sort().map((code) => ({ code, severity: DQ_SEVERITY[code] }));
}
