import { dataShapeIssues } from '../schemas/data.js';

// Data understanding: deterministic data-quality findings, computed before any
// model call. Findings are authoritative, are shown to the model, and are
// returned in the output (`dataQuality`) so a reviewer sees them even if the
// prose misses them.
//
//   conflict : the data contradicts itself or is impossible
//   missing  : an input is absent or undefined, so related metrics are unavailable
//   info     : worth knowing; not an error
//
// Severities and codes are data-quality facts, not business thresholds.

export const DQ_SEVERITY = {
  PRESENT_GT_EXPECTED: 'conflict',
  NEGATIVE_VALUE: 'conflict',
  DISTRIBUTED_GT_PLANNED: 'conflict',
  DUPLICATE_LABEL: 'conflict',
  RATE_OUT_OF_RANGE: 'conflict',
  TARGET_ZERO: 'conflict',
  NONNUMERIC: 'conflict',
  FIELD_MISSING: 'missing',
  TARGET_MISSING: 'missing',
  DENOMINATOR_ZERO: 'missing',
  PREVIOUS_ZERO: 'info',
  PERIODS_SELLERS_MISMATCH: 'info',
};

// Plain-language meanings (no digits, so they never trip the numeric check).
export const DQ_MEANING = {
  PRESENT_GT_EXPECTED: {
    en: 'present attendance exceeds expected attendance, so the attendance figures are inconsistent and need verification',
    ar: 'عدد الحاضرين يتجاوز العدد المتوقع، لذلك أرقام الحضور غير متسقة وتحتاج إلى تحقق',
  },
  NEGATIVE_VALUE: {
    en: 'a supplied figure is negative, which is invalid for counts; the source data must be verified',
    ar: 'أحد الأرقام المدخلة سالب وهذا غير صالح للأعداد، ويجب التحقق من البيانات المصدر',
  },
  DISTRIBUTED_GT_PLANNED: {
    en: 'gifts distributed exceed gifts planned, which conflicts with the plan; the data must be verified',
    ar: 'الهدايا الموزعة تتجاوز المخطط لها وهذا يتعارض مع الخطة، ويجب التحقق من البيانات',
  },
  DUPLICATE_LABEL: {
    en: 'the same label appears more than once, so per-label figures are ambiguous; the data must be verified',
    ar: 'نفس الرمز مكرر أكثر من مرة، لذلك أرقام كل رمز غامضة، ويجب التحقق من البيانات',
  },
  RATE_OUT_OF_RANGE: {
    en: 'an attendance rate is outside the valid range of zero to one, so it looks mis-scaled; the data must be verified',
    ar: 'نسبة حضور خارج النطاق الصحيح من صفر إلى واحد وتبدو مقاسة بشكل خاطئ، ويجب التحقق من البيانات',
  },
  TARGET_ZERO: {
    en: 'a target is zero, so attainment against it cannot be computed; the target must be verified',
    ar: 'أحد الأهداف يساوي صفراً، لذلك لا يمكن حساب نسبة التحقق منه، ويجب التحقق من الهدف',
  },
  NONNUMERIC: {
    en: 'a field that should be a number has another type, so it is treated as missing; the data must be verified',
    ar: 'حقل يفترض أن يكون رقماً من نوع آخر ويعامل كأنه مفقود، ويجب التحقق من البيانات',
  },
  FIELD_MISSING: {
    en: 'some input figures are missing, so the related metrics are unavailable',
    ar: 'بعض الأرقام المدخلة مفقودة، لذلك المؤشرات المرتبطة بها غير متاحة',
  },
  TARGET_MISSING: {
    en: 'a target is missing, so attainment and gap to target are unavailable',
    ar: 'الهدف مفقود، لذلك نسبة التحقق والفجوة عن الهدف غير متاحتين',
  },
  DENOMINATOR_ZERO: {
    en: 'a denominator is zero (expected attendance or planned gifts), so the related rate is unavailable',
    ar: 'المقام يساوي صفراً (الحضور المتوقع أو الهدايا المخططة)، لذلك النسبة المرتبطة غير متاحة',
  },
  PREVIOUS_ZERO: {
    en: 'previous sales are zero, so the percentage change is unavailable',
    ar: 'مبيعات الفترة السابقة تساوي صفراً، لذلك نسبة التغير غير متاحة',
  },
  PERIODS_SELLERS_MISMATCH: {
    en: 'period totals differ from seller totals; the two may cover different scopes',
    ar: 'مجموع الفترات يختلف عن مجموع البائعين وقد يغطيان نطاقين مختلفين',
  },
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const sum = (xs) => (xs.length > 0 && xs.every(isNum) ? xs.reduce((s, x) => s + x, 0) : null);

function anyNegative(v) {
  if (isNum(v)) return v < 0;
  if (Array.isArray(v)) return v.some(anyNegative);
  if (v && typeof v === 'object') return Object.values(v).some(anyNegative);
  return false;
}

const hasDuplicates = (list) => {
  const labels = list.map((x) => String(x?.label));
  return new Set(labels).size !== labels.length;
};

export function profileData(capability, data = {}) {
  const codes = new Set();
  const d = data ?? {};
  const a = d.attendance ?? {};
  const s = d.sales ?? {};
  const g = d.gifts ?? {};

  if (dataShapeIssues(capability, d).length > 0) codes.add('NONNUMERIC');
  if (anyNegative(d)) codes.add('NEGATIVE_VALUE');

  if (capability === 'supervisor_daily_summary' || capability === 'campaign_insights') {
    const required = capability === 'supervisor_daily_summary'
      ? [a.present, a.expected, s.units, s.previousUnits, g.distributed, g.planned]
      : [a.present, a.expected, s.units, g.distributed, g.planned];
    if (required.some((v) => !isNum(v))) codes.add('FIELD_MISSING');
    if (isNum(a.present) && isNum(a.expected) && a.present > a.expected) codes.add('PRESENT_GT_EXPECTED');
    if (a.expected === 0 || g.planned === 0) codes.add('DENOMINATOR_ZERO');
    if (isNum(g.distributed) && isNum(g.planned) && g.distributed > g.planned) codes.add('DISTRIBUTED_GT_PLANNED');
    if (capability === 'supervisor_daily_summary' && s.previousUnits === 0) codes.add('PREVIOUS_ZERO');
    if (capability === 'campaign_insights') {
      if (!isNum(s.target)) codes.add('TARGET_MISSING');
      if (s.target === 0) codes.add('TARGET_ZERO');
    }
  }

  if (capability === 'sales_performance') {
    const sellers = arr(d.sellers);
    if (hasDuplicates(sellers)) codes.add('DUPLICATE_LABEL');
    if (sellers.some((x) => !isNum(x?.units))) codes.add('FIELD_MISSING');
    if (sellers.some((x) => !isNum(x?.target))) codes.add('TARGET_MISSING');
    if (sellers.some((x) => x?.target === 0)) codes.add('TARGET_ZERO');
    const su = sum(sellers.map((x) => x?.units));
    const pu = sum(arr(d.periods).map((x) => x?.units));
    if (su !== null && pu !== null && su !== pu) codes.add('PERIODS_SELLERS_MISMATCH');
  }

  if (capability === 'animateur_coaching') {
    const list = arr(d.animateurs);
    if (hasDuplicates(list)) codes.add('DUPLICATE_LABEL');
    if (list.some((x) => isNum(x?.attendanceRate) && (x.attendanceRate > 1 || x.attendanceRate < 0))) codes.add('RATE_OUT_OF_RANGE');
    if (list.some((x) => !isNum(x?.units) || !isNum(x?.visits) || !isNum(x?.attendanceRate))) codes.add('FIELD_MISSING');
    if (list.some((x) => !isNum(x?.target))) codes.add('TARGET_MISSING');
    if (list.some((x) => x?.target === 0)) codes.add('TARGET_ZERO');
  }

  return [...codes].sort().map((code) => ({ code, severity: DQ_SEVERITY[code] }));
}
