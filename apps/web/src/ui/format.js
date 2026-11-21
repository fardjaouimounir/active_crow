import { useTranslation } from 'react-i18next';

/** Thin space: the thousands separator (1 500 000), identical in English and Arabic. */
export const THIN = ' ';
const NO_BREAK_THIN = ' ';

const intlLocale = (language) => (language?.startsWith('ar') ? 'ar-DZ-u-nu-latn' : 'en-GB');
const grouped = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, THIN);

/** `1 500 000`; `—` when there is no figure (null/undefined/NaN), never a made-up 0. */
export function formatNumber(value, { decimals = 0 } = {}) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const number = Number(value);
  const [whole, fraction] = Math.abs(number).toFixed(decimals).split('.');
  return `${number < 0 ? '−' : ''}${grouped(whole)}${fraction ? '.' + fraction : ''}`;
}

/** `1 500 000 DA` / `1 500 000 دج`. Amounts arrive as decimal strings. */
export function formatCurrency(value, language) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const unit = language?.startsWith('ar') ? 'دج' : 'DA';
  return `${formatNumber(value)}${NO_BREAK_THIN}${unit}`;
}

/** Fractions (0.4796) become `48.0%`; one decimal everywhere. */
export function formatPercent(fraction) {
  if (fraction == null || Number.isNaN(Number(fraction))) return '—';
  return `${(Number(fraction) * 100).toFixed(1)}%`;
}

/** Compact relative time (`12 min ago` / `منذ 12 د`) for a past instant. */
export function formatRelative(instant, language, now = Date.now()) {
  const seconds = Math.round((new Date(instant).getTime() - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(intlLocale(language), {
    numeric: 'auto',
    style: 'short',
  });
  const steps = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(0, 'second');
}

/** Absolute date and time in the agency time zone (tooltips next to relative times). */
export function formatDateTime(instant, language) {
  return new Intl.DateTimeFormat(intlLocale(language), {
    timeZone: 'Africa/Algiers',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(instant));
}

export function formatDate(instant, language, options = { dateStyle: 'medium' }) {
  return new Intl.DateTimeFormat(intlLocale(language), {
    timeZone: 'Africa/Algiers',
    ...options,
  }).format(new Date(instant));
}

/** One place for locale-aware figures in components. */
export function useFormat() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  return {
    language,
    rtl: language.startsWith('ar'),
    num: formatNumber,
    money: (value) => formatCurrency(value, language),
    pct: formatPercent,
    ago: (instant) => formatRelative(instant, language),
    when: (instant) => formatDateTime(instant, language),
    date: (instant, options) => formatDate(instant, language, options),
  };
}
