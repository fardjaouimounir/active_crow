import { getIntlLocale } from '../../shared/i18n/index.js';

/**
 * Formats a decimal-string amount (CLAUDE.md §6) in DZD for the UI language.
 * @param {string | null | undefined} value e.g. `"1250.50"`
 * @param {string} language i18n language code
 */
export function formatMoney(value, language) {
  if (value == null) return '—';
  return new Intl.NumberFormat(getIntlLocale(language), {
    style: 'currency',
    currency: 'DZD',
  }).format(Number(value));
}
