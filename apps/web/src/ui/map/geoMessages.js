import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

// [English, Arabic] pairs for every map and heatmap view (kept out of common.json so the bundle every
// surface loads, including /field, stays small).
export const messages = {
  geography: ['Geography', 'الجغرافيا'],
  wilayas: ['Wilayas', 'الولايات'],
  stores: ['Stores', 'نقاط البيع'],
  timing: ['Timing', 'التوقيت'],
  metric: ['Metric', 'المؤشر'],
  'metric.sales_units': ['Units sold', 'الوحدات المباعة'],
  'metric.buyers': ['Buyers', 'المشترون'],
  'metric.conversion_rate': ['Conversion rate', 'معدل التحويل'],
  'metric.attendance_rate': ['Attendance rate', 'معدل الحضور'],
  'metric.gift_distribution_rate': ['Gift distribution rate', 'معدل توزيع الهدايا'],
  'metric.store_coverage': ['Store coverage', 'تغطية نقاط البيع'],
  'metric.undelivered_units': ['Undelivered gift units', 'وحدات الهدايا غير المسلّمة'],
  change: ['Change vs previous period', 'التغيّر مقارنةً بالفترة السابقة'],
  period: ['Period', 'الفترة'],
  noData: ['No data', 'لا بيانات'],
  rank: ['Rank {{rank}} of {{count}}', 'المرتبة {{rank}} من {{count}}'],
  includes: ['Includes', 'تشمل'],
  top: ['Top 5', 'الأعلى 5'],
  bottom: ['Bottom 5', 'الأدنى 5'],
  reset: ['Reset wilaya filter', 'إزالة مرشح الولاية'],
  filteredBy: ['Filtered to {{names}}', 'مُرشّح على {{names}}'],
  clickHint: [
    'Click a wilaya to filter the whole dashboard to it.',
    'انقر على ولاية لتصفية لوحة الأداء بالكامل عليها.',
  ],
  viewTable: ['View as table', 'عرض كجدول'],
  mapLabel: ['Map of Algeria by wilaya', 'خريطة الجزائر حسب الولاية'],
  noBasemap: [
    'The basemap could not be loaded. Showing wilaya boundaries only.',
    'تعذّر تحميل الخريطة الأساسية. تُعرض حدود الولايات فقط.',
  ],
  mapError: ['Unable to load the interactive map.', 'تعذّر تحميل الخريطة التفاعلية.'],
  wholeCountry: ['Whole country', 'كامل البلاد'],
  fitData: ['Fit to data', 'عرض الولايات التي تحتوي على بيانات'],
  noWebgl: [
    'Interactive map is unavailable in this browser. Showing a simplified map.',
    'الخريطة التفاعلية غير متاحة في هذا المتصفح. تُعرض خريطة مبسّطة.',
  ],
  loading: ['Loading map…', 'جارٍ تحميل الخريطة…'],
  error: ['The map could not be loaded.', 'تعذّر تحميل الخريطة.'],
  attribution: [
    'Boundaries © OpenStreetMap contributors (ODbL), via geoBoundaries',
    'الحدود © مساهمو OpenStreetMap (ODbL) عبر geoBoundaries',
  ],
  units: ['units', 'وحدة'],
  buyersCount: ['buyers', 'مشترٍ'],
  // Store map
  storeMap: ['Store map', 'خريطة نقاط البيع'],
  colorBy: ['Colour by', 'التلوين حسب'],
  'colorBy.visit': ['Visited in the last 7 days', 'زيارة خلال آخر 7 أيام'],
  'colorBy.issues': ['Open issues', 'بلاغات مفتوحة'],
  'colorBy.attendance': ['Attendance rate', 'معدل الحضور'],
  'colorBy.today': ['Attendance today', 'حضور اليوم'],
  heat: ['Sales density', 'كثافة المبيعات'],
  visited: ['Visited', 'تمت زيارتها'],
  notVisited: ['Not visited', 'لم تُزر'],
  hasIssues: ['Open issues', 'بلاغات مفتوحة'],
  noIssues: ['No open issues', 'لا بلاغات مفتوحة'],
  attendanceGood: ['80% or more', '80% فأكثر'],
  attendanceMid: ['50 to 80%', 'من 50% إلى 80%'],
  attendanceLow: ['Under 50%', 'أقل من 50%'],
  present: ['Present', 'حاضر'],
  late: ['Late', 'متأخر'],
  notSent: ['Not sent', 'لم يُرسل'],
  absent: ['Absent', 'غائب'],
  noToday: ['No one scheduled today', 'لا أحد مجدوَل اليوم'],
  lastVisit: ['Last visit', 'آخر زيارة'],
  never: ['Never', 'أبدًا'],
  openIssues: ['Open issues', 'البلاغات المفتوحة'],
  attendanceRate: ['Attendance', 'الحضور'],
  sales: ['Sales', 'المبيعات'],
  unlocated: ['Stores without coordinates ({{count}})', 'نقاط بيع بلا إحداثيات ({{count}})'],
  unlocatedHint: [
    'These stores are not placed on the map until their location is set.',
    'لا تظهر نقاط البيع هذه على الخريطة قبل تحديد موقعها.',
  ],
  noStores: ['No stores with a location for these filters.', 'لا نقاط بيع ذات موقع لهذه المرشحات.'],
  openStore: ['Open store', 'فتح نقطة البيع'],
  openBoard: ['Open attendance board', 'فتح لوحة الحضور'],
  close: ['Close', 'إغلاق'],
  // Live map
  live: ['Today in the field', 'اليوم في الميدان'],
  liveHint: ['Refreshes every minute.', 'يتحدّث كل دقيقة.'],
  // Check-in mini-map
  checkinMap: ['Check-in location', 'موقع تسجيل الحضور'],
  storePoint: ['Store', 'نقطة البيع'],
  checkinPoint: ['Check-in', 'تسجيل الحضور'],
  allowedRadius: ['Allowed radius: {{meters}} m', 'النطاق المسموح: {{meters}} م'],
  distance: ['Distance: {{meters}} m', 'المسافة: {{meters}} م'],
  noStoreLocation: ['The store has no location.', 'لا موقع لنقطة البيع.'],
  // Heatmaps
  'heatmap.sales': [
    'Sales by weekday and hour (number of sales)',
    'المبيعات حسب اليوم والساعة (عدد عمليات البيع)',
  ],
  'heatmap.attendance_late': [
    'Late check-ins by weekday and hour',
    'التأخر في الحضور حسب اليوم والساعة',
  ],
  heatmapNote: [
    'Hours are Algiers time. Darker means more.',
    'الساعات بتوقيت الجزائر. اللون الأغمق يعني عددًا أكبر.',
  ],
  count: ['Count', 'العدد'],
  hour: ['Hour', 'الساعة'],
  weekday: ['Weekday', 'اليوم'],
  total: ['Total', 'المجموع'],
  emptyHeatmap: ['No activity in this period.', 'لا نشاط في هذه الفترة.'],
};

/** Texts and number formats of the map views in the active language. */
export function useGeoText() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const rtl = language.startsWith('ar');
  const locale = rtl ? 'ar-DZ-u-nu-latn' : 'en-GB';
  // Stable per language, so memoised map models do not rebuild on every render.
  return useMemo(() => {
    const t = (key, values = {}) =>
      Object.entries(values).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        messages[key]?.[rtl ? 1 : 0] ?? key,
      );
    const number = (value) => (value == null ? '—' : new Intl.NumberFormat(locale).format(value));
    const percent = (value) =>
      value == null
        ? '—'
        : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(
            value,
          );
    const date = (value) =>
      value
        ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
            new Date(value.length > 10 ? value : value + 'T00:00:00Z'),
          )
        : '—';
    const name = (item) => (rtl && item?.nameAr) || item?.nameEn || '';
    return { t, rtl, language, locale, number, percent, date, name };
  }, [language, rtl, locale]);
}
