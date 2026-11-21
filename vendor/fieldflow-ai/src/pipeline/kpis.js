// Deterministic KPI computation. The model never supplies numbers.
//
// Every metric is registered with its unit, the inputs it needs and a formula.
// A metric is UNDEFINED (null internally, omitted from the kpis object) when an
// input is missing / not a finite number, or its denominator is 0. It is never
// reported as 0: "no target" must not read as "0% attainment". An aggregate over
// several entities is undefined when any entity lacks the field (no silent
// partial sums). Defined values are rounded to 3 decimals.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const r3 = (x) => Math.round(x * 1000) / 1000;
const arr = (v) => (Array.isArray(v) ? v : []);
const val = (v) => (isNum(v) ? v : null);
const div = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);
const sub = (a, b) => (isNum(a) && isNum(b) ? r3(a - b) : null);
const rate = (a, b) => { const q = div(a, b); return q === null ? null : r3(q); };
const pct = (a, b) => { const q = div(a, b); return q === null ? null : r3(q * 100); };
const sumAll = (xs) => (xs.length > 0 && xs.every(isNum) ? r3(xs.reduce((s, x) => s + x, 0)) : null);
const meanAll = (xs) => (xs.length > 0 && xs.every(isNum) ? r3(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

const blocks = (data) => ({ a: data.attendance ?? {}, s: data.sales ?? {}, g: data.gifts ?? {} });
const col = (data, key, field) => arr(data[key]).map((x) => x?.[field]);

// unit: count | rate (0..1) | pct (0..100). inputs: the request fields the metric needs.
export const METRICS = {
  supervisor_daily_summary: [
    { id: 'presentCount', unit: 'count', inputs: ['attendance.present'], compute: (d) => val(blocks(d).a.present) },
    { id: 'expectedCount', unit: 'count', inputs: ['attendance.expected'], compute: (d) => val(blocks(d).a.expected) },
    { id: 'missingCount', unit: 'count', inputs: ['attendance.expected', 'attendance.present'], compute: (d) => sub(blocks(d).a.expected, blocks(d).a.present) },
    { id: 'attendanceRate', unit: 'rate', inputs: ['attendance.present', 'attendance.expected'], compute: (d) => rate(blocks(d).a.present, blocks(d).a.expected) },
    { id: 'units', unit: 'count', inputs: ['sales.units'], compute: (d) => val(blocks(d).s.units) },
    { id: 'previousUnits', unit: 'count', inputs: ['sales.previousUnits'], compute: (d) => val(blocks(d).s.previousUnits) },
    { id: 'unitsDeltaPct', unit: 'pct', inputs: ['sales.units', 'sales.previousUnits'], compute: (d) => pct(sub(blocks(d).s.units, blocks(d).s.previousUnits), blocks(d).s.previousUnits) },
    { id: 'distributedGifts', unit: 'count', inputs: ['gifts.distributed'], compute: (d) => val(blocks(d).g.distributed) },
    { id: 'plannedGifts', unit: 'count', inputs: ['gifts.planned'], compute: (d) => val(blocks(d).g.planned) },
    { id: 'giftGap', unit: 'count', inputs: ['gifts.planned', 'gifts.distributed'], compute: (d) => sub(blocks(d).g.planned, blocks(d).g.distributed) },
    { id: 'giftDistributionRate', unit: 'rate', inputs: ['gifts.distributed', 'gifts.planned'], compute: (d) => rate(blocks(d).g.distributed, blocks(d).g.planned) },
  ],
  sales_performance: [
    { id: 'sellerCount', unit: 'count', inputs: ['sellers'], compute: (d) => arr(d.sellers).length },
    { id: 'totalUnits', unit: 'count', inputs: ['sellers[].units'], compute: (d) => sumAll(col(d, 'sellers', 'units')) },
    { id: 'totalTarget', unit: 'count', inputs: ['sellers[].target'], compute: (d) => sumAll(col(d, 'sellers', 'target')) },
    { id: 'targetGap', unit: 'count', inputs: ['sellers[].target', 'sellers[].units'], compute: (d) => sub(sumAll(col(d, 'sellers', 'target')), sumAll(col(d, 'sellers', 'units'))) },
    { id: 'targetAttainmentPct', unit: 'pct', inputs: ['sellers[].units', 'sellers[].target'], compute: (d) => pct(sumAll(col(d, 'sellers', 'units')), sumAll(col(d, 'sellers', 'target'))) },
    { id: 'topSellerUnits', unit: 'count', inputs: ['sellers[].units'], compute: (d) => { const u = col(d, 'sellers', 'units'); return u.length > 0 && u.every(isNum) ? Math.max(...u) : null; } },
    { id: 'periodCount', unit: 'count', inputs: ['periods'], compute: (d) => arr(d.periods).length },
    { id: 'lastPeriodUnits', unit: 'count', inputs: ['periods[].units'], compute: (d) => (arr(d.periods).length > 0 ? val(arr(d.periods).at(-1)?.units) : null) },
  ],
  campaign_insights: [
    { id: 'attendanceRate', unit: 'rate', inputs: ['attendance.present', 'attendance.expected'], compute: (d) => rate(blocks(d).a.present, blocks(d).a.expected) },
    { id: 'attendanceGap', unit: 'count', inputs: ['attendance.expected', 'attendance.present'], compute: (d) => sub(blocks(d).a.expected, blocks(d).a.present) },
    { id: 'units', unit: 'count', inputs: ['sales.units'], compute: (d) => val(blocks(d).s.units) },
    { id: 'target', unit: 'count', inputs: ['sales.target'], compute: (d) => val(blocks(d).s.target) },
    { id: 'targetGap', unit: 'count', inputs: ['sales.target', 'sales.units'], compute: (d) => sub(blocks(d).s.target, blocks(d).s.units) },
    { id: 'targetAttainmentPct', unit: 'pct', inputs: ['sales.units', 'sales.target'], compute: (d) => pct(blocks(d).s.units, blocks(d).s.target) },
    { id: 'giftDistributionRate', unit: 'rate', inputs: ['gifts.distributed', 'gifts.planned'], compute: (d) => rate(blocks(d).g.distributed, blocks(d).g.planned) },
    // Pure arithmetic on supplied fields (the prompt lets the model cite these).
    { id: 'giftGap', unit: 'count', inputs: ['gifts.planned', 'gifts.distributed'], compute: (d) => sub(blocks(d).g.planned, blocks(d).g.distributed) },
    { id: 'giftRemainingPct', unit: 'pct', inputs: ['gifts.planned', 'gifts.distributed'], compute: (d) => pct(sub(blocks(d).g.planned, blocks(d).g.distributed), blocks(d).g.planned) },
    { id: 'targetShortfallPct', unit: 'pct', inputs: ['sales.target', 'sales.units'], compute: (d) => pct(sub(blocks(d).s.target, blocks(d).s.units), blocks(d).s.target) },
  ],
  animateur_coaching: [
    { id: 'animateurCount', unit: 'count', inputs: ['animateurs'], compute: (d) => arr(d.animateurs).length },
    { id: 'avgAttendanceRate', unit: 'rate', inputs: ['animateurs[].attendanceRate'], compute: (d) => meanAll(col(d, 'animateurs', 'attendanceRate')) },
    { id: 'totalUnits', unit: 'count', inputs: ['animateurs[].units'], compute: (d) => sumAll(col(d, 'animateurs', 'units')) },
    { id: 'totalTarget', unit: 'count', inputs: ['animateurs[].target'], compute: (d) => sumAll(col(d, 'animateurs', 'target')) },
    { id: 'targetGap', unit: 'count', inputs: ['animateurs[].target', 'animateurs[].units'], compute: (d) => sub(sumAll(col(d, 'animateurs', 'target')), sumAll(col(d, 'animateurs', 'units'))) },
    { id: 'attainmentPct', unit: 'pct', inputs: ['animateurs[].units', 'animateurs[].target'], compute: (d) => pct(sumAll(col(d, 'animateurs', 'units')), sumAll(col(d, 'animateurs', 'target'))) },
    { id: 'avgVisits', unit: 'count', inputs: ['animateurs[].visits'], compute: (d) => meanAll(col(d, 'animateurs', 'visits')) },
  ],
};

function evaluate(capability, data) {
  const defs = METRICS[capability];
  if (!defs) throw new Error(`Unknown capability: ${capability}`);
  const d = data ?? {};
  return defs.map((m) => [m.id, m.compute(d)]);
}

// Defined metrics only; undefined metrics are omitted (never 0).
export function computeKpis(capability, data) {
  return Object.fromEntries(evaluate(capability, data).filter(([, v]) => v !== null));
}

// Ids of metrics that cannot be computed from the supplied data.
export function computeUnavailable(capability, data) {
  return evaluate(capability, data).filter(([, v]) => v === null).map(([id]) => id);
}

export const supervisorDailyKpis = (data = {}) => computeKpis('supervisor_daily_summary', data);
export const salesPerformanceKpis = (data = {}) => computeKpis('sales_performance', data);
export const campaignInsightsKpis = (data = {}) => computeKpis('campaign_insights', data);
export const animateurCoachingKpis = (data = {}) => computeKpis('animateur_coaching', data);

// Ranking is code-computed, never narrated from the model's imagination.
export function computeRanking(data = {}) {
  const sellers = Array.isArray(data.sellers) ? data.sellers : [];
  return [...sellers]
    .sort((a, b) => (Number(b?.units) || 0) - (Number(a?.units) || 0))
    .map((s) => String(s?.label ?? '').trim())
    .filter(Boolean);
}

const EXPECTED_PATHS = {
  supervisor_daily_summary: [
    'attendance.present', 'attendance.expected',
    'sales.units', 'sales.previousUnits',
    'gifts.distributed', 'gifts.planned',
  ],
  sales_performance: ['sellers', 'periods'],
  campaign_insights: ['attendance.present', 'attendance.expected', 'sales.units', 'sales.target', 'gifts.planned'],
  animateur_coaching: ['animateurs'],
};

// Per-row fields that must be present (and numeric) for a row to be complete.
const ROW_FIELDS = {
  sales_performance: { sellers: ['units', 'target'], periods: ['units'] },
  animateur_coaching: { animateurs: ['attendanceRate', 'units', 'target', 'visits'] },
};

function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

// Completeness = mean of: each expected top-level path (present = 1), and, for
// list capabilities, the share of numeric per-row fields that are present.
// A missing seller target therefore lowers confidence instead of passing as complete.
export function computeCompleteness(capability, data = {}) {
  const paths = EXPECTED_PATHS[capability] ?? [];
  if (paths.length === 0) return 1;
  const items = paths.map((p) => {
    const v = getPath(data, p);
    return v !== undefined && v !== null && v !== '' ? 1 : 0;
  });
  for (const [key, fields] of Object.entries(ROW_FIELDS[capability] ?? {})) {
    const rows = arr(data?.[key]);
    const total = rows.length * fields.length;
    items.push(total === 0 ? 0 : rows.reduce((n, row) => n + fields.filter((f) => isNum(row?.[f])).length, 0) / total);
  }
  return r3(items.reduce((a, b) => a + b, 0) / items.length);
}

// Per-entity figures computed in CODE from the request data, so the model can
// talk about a single seller / animateur / period without doing arithmetic
// itself: gap to target, attainment %, and the change between periods.
// These are authoritative (like KPIs) and are added to the numeric allow-list.
export function derivedFigures(data = {}) {
  const out = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (!Array.isArray(value)) continue;
    const rows = value.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
    const list = [];
    rows.forEach((row, i) => {
      const entry = {};
      if (row.label != null) entry.label = String(row.label);
      if (isNum(row.units) && isNum(row.target) && row.target !== 0) {
        entry.gapToTarget = r3(row.target - row.units);
        entry.attainmentPct = r3((row.units / row.target) * 100);
      }
      if (key === 'periods' && i > 0 && isNum(row.units) && isNum(rows[i - 1].units)) {
        entry.changeUnits = r3(row.units - rows[i - 1].units);
        if (rows[i - 1].units !== 0) entry.changePct = r3(((row.units - rows[i - 1].units) / rows[i - 1].units) * 100);
      }
      if (Object.keys(entry).some((k) => k !== 'label')) list.push(entry);
    });
    if (list.length) out[key] = list;
  }
  return out;
}
