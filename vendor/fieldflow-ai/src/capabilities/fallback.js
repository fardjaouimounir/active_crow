import { DQ_MEANING } from '../pipeline/data-quality.js';

// Deterministic templated report, used only when the model output cannot be
// accepted. It states ONLY metrics that are defined (an undefined metric is
// absent from `kpis`, never 0) and always says what is wrong with the data.

const round3 = (n) => String(Math.round(Number(n) * 1000) / 1000);
const pct = (n) => String(Math.round(Number(n) * 100 * 1000) / 1000);
const has = (kpis, key) => Number.isFinite(kpis?.[key]);

const T = {
  en: {
    headlineAttendanceUnits: (k) => `Attendance ${pct(k.attendanceRate)} percent; units ${round3(k.units)}.`,
    headlineAttendance: (k) => `Attendance ${pct(k.attendanceRate)} percent.`,
    headlineUnits: (k) => `Units sold: ${round3(k.units)}.`,
    headlinePartial: 'Partial report: some figures are unavailable.',
    attendance: (k) => `Attendance reached ${pct(k.attendanceRate)} percent of ${round3(k.expectedCount)} expected.`,
    unitsVs: (k) => `Units sold: ${round3(k.units)}, versus ${round3(k.previousUnits)} previously.`,
    units: (k) => `Units sold: ${round3(k.units)}.`,
    gifts: (k) => `Gift distribution: ${pct(k.giftDistributionRate)} percent of ${round3(k.plannedGifts)} planned.`,
    totalUnits: (k) => `Total units: ${round3(k.totalUnits)}.`,
    campaignAttainment: (k) => `The campaign reached ${round3(k.targetAttainmentPct)} percent of target.`,
    campaignUnits: (k) => `The campaign sold ${round3(k.units)} units; attainment against target is unavailable.`,
    campaignNone: 'The campaign narrative is limited because key figures are unavailable.',
    coachingAttainment: (k) => `Reach ${round3(k.attainmentPct)} percent of target.`,
    pad: 'Some figures are unavailable because input data is missing or inconsistent.',
    verify: 'Verify the source data before acting on these figures.',
  },
  ar: {
    headlineAttendanceUnits: (k) => `الحضور ${pct(k.attendanceRate)} بالمئة؛ المبيعات ${round3(k.units)} وحدة.`,
    headlineAttendance: (k) => `الحضور ${pct(k.attendanceRate)} بالمئة.`,
    headlineUnits: (k) => `المبيعات ${round3(k.units)} وحدة.`,
    headlinePartial: 'تقرير جزئي: بعض الأرقام غير متاحة.',
    attendance: (k) => `الحضور ${pct(k.attendanceRate)} بالمئة من ${round3(k.expectedCount)} متوقع.`,
    unitsVs: (k) => `المبيعات ${round3(k.units)} وحدة مقارنة بـ ${round3(k.previousUnits)} سابقاً.`,
    units: (k) => `المبيعات ${round3(k.units)} وحدة.`,
    gifts: (k) => `توزيع الهدايا ${pct(k.giftDistributionRate)} بالمئة من ${round3(k.plannedGifts)} مخطط.`,
    totalUnits: (k) => `إجمالي المبيعات ${round3(k.totalUnits)} وحدة.`,
    campaignAttainment: (k) => `تحقق الحملة ${round3(k.targetAttainmentPct)} بالمئة من الهدف.`,
    campaignUnits: (k) => `باعت الحملة ${round3(k.units)} وحدة؛ نسبة التحقق من الهدف غير متاحة.`,
    campaignNone: 'سرد الحملة محدود لأن أرقاماً أساسية غير متاحة.',
    coachingAttainment: (k) => `تحقيق ${round3(k.attainmentPct)} بالمئة من الهدف.`,
    pad: 'بعض الأرقام غير متاحة لأن البيانات المدخلة ناقصة أو غير متسقة.',
    verify: 'تحقق من البيانات المصدر قبل اتخاذ إجراء بناءً على هذه الأرقام.',
  },
};

export function buildFallback(capabilityId, locale, kpis = {}, ranking = [], findings = []) {
  const t = T[locale === 'ar' ? 'ar' : 'en'];
  const lang = locale === 'ar' ? 'ar' : 'en';
  const notes = findings.filter((f) => f.severity !== 'info').map((f) => DQ_MEANING[f.code]?.[lang]).filter(Boolean);
  const hasFindings = notes.length > 0;
  const base = { locale: lang, kpis };
  const dq = findings.length > 0 ? { dataQuality: findings } : {};

  switch (capabilityId) {
    case 'supervisor_daily_summary': {
      const lines = [];
      if (has(kpis, 'attendanceRate') && has(kpis, 'expectedCount')) lines.push(t.attendance(kpis));
      if (has(kpis, 'units') && has(kpis, 'previousUnits')) lines.push(t.unitsVs(kpis));
      else if (has(kpis, 'units')) lines.push(t.units(kpis));
      if (has(kpis, 'giftDistributionRate') && has(kpis, 'plannedGifts')) lines.push(t.gifts(kpis));
      lines.push(...notes);
      while (lines.length < 3) lines.push(t.pad);
      const hasA = has(kpis, 'attendanceRate');
      const hasU = has(kpis, 'units');
      return {
        ...base,
        headline: hasA && hasU ? t.headlineAttendanceUnits(kpis) : hasA ? t.headlineAttendance(kpis) : hasU ? t.headlineUnits(kpis) : t.headlinePartial,
        summary: lines.slice(0, 5),
        attention: findings.filter((f) => f.severity === 'conflict').map((f) => ({ type: 'data_quality', text: DQ_MEANING[f.code][lang], refs: [] })),
        recommendedActions: hasFindings ? [t.verify] : [],
        ...dq,
      };
    }
    case 'sales_performance':
      return {
        ...base,
        ranking,
        trends: has(kpis, 'totalUnits') ? [t.totalUnits(kpis)] : [],
        anomalies: notes,
        recommendedActions: hasFindings ? [t.verify] : [],
        ...dq,
      };
    case 'campaign_insights':
      return {
        ...base,
        narrative: has(kpis, 'targetAttainmentPct') ? t.campaignAttainment(kpis) : has(kpis, 'units') ? t.campaignUnits(kpis) : t.campaignNone,
        risks: notes.map((text) => ({ severity: 'medium', text, evidence: [] })),
        opportunities: [],
        decisions: hasFindings ? [t.verify] : [],
        ...dq,
      };
    case 'animateur_coaching':
      return {
        ...base,
        coaching: [],
        campaignActions: [
          ...(has(kpis, 'attainmentPct') ? [t.coachingAttainment(kpis)] : []),
          ...(hasFindings ? [t.verify] : []),
          ...notes,
        ],
        ...dq,
      };
    default:
      throw new Error(`Unknown capability: ${capabilityId}`);
  }
}
