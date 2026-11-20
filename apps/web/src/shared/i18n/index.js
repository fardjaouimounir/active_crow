import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import arAuth from './locales/ar/auth.json';
import arCommon from './locales/ar/common.json';
import arSystem from './locales/ar/system.json';
import enAuth from './locales/en/auth.json';
import enCommon from './locales/en/common.json';
import enSystem from './locales/en/system.json';

/** UI languages. `intlLocale` is used for Intl number/date formatting. */
export const LANGUAGES = Object.freeze([
  { code: 'en', intlLocale: 'en-GB' },
  { code: 'ar', intlLocale: 'ar-DZ' },
]);
export const DEFAULT_LANGUAGE = 'en';
export const TIME_ZONE = 'Africa/Algiers';

const STORAGE_KEY = 'fieldflow.language';

// One namespace per feature (plus `common`), so features own their strings.
export const resources = {
  en: { common: enCommon, auth: enAuth, system: enSystem },
  ar: { common: arCommon, auth: arAuth, system: arSystem },
};

function readStoredLanguage() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return LANGUAGES.some((language) => language.code === stored) ? stored : null;
  } catch {
    return null; // storage blocked (private mode, sandbox): fall back to the default
  }
}

function storeLanguage(code) {
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // storage blocked: the choice simply lasts for this session
  }
}

/** Sets `<html lang>` and `<html dir>` so the whole layout flips for RTL languages. */
function applyToDocument(code) {
  document.documentElement.lang = code;
  document.documentElement.dir = i18n.dir(code);
}

/** @param {string} code */
export function getIntlLocale(code) {
  return LANGUAGES.find((language) => language.code === code)?.intlLocale ?? code;
}

i18n.use(initReactI18next).init({
  resources,
  lng: readStoredLanguage() ?? DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: LANGUAGES.map((language) => language.code),
  ns: Object.keys(resources.en),
  defaultNS: 'common',
  interpolation: { escapeValue: false }, // React already escapes
  initAsync: false,
});

i18n.on('languageChanged', (code) => {
  applyToDocument(code);
  storeLanguage(code);
});
applyToDocument(i18n.resolvedLanguage ?? DEFAULT_LANGUAGE);

export default i18n;
