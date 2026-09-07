import { AppError } from './errors.js';
import { en } from './locales/en.js';
import { ru } from './locales/ru.js';
import { uk } from './locales/uk.js';
import { cs } from './locales/cs.js';
import { de } from './locales/de.js';

export const SUPPORTED_LOCALES = Object.freeze(['en', 'uk', 'cs', 'de', 'ru']);

export const messages = {
  en,
  ru,
  uk,
  cs,
  de,
};

let locale = 'en';

export function t(key, parameters = {}) {
  const template = messages[locale]?.[key] || messages.en[key] || key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(parameters[name] ?? `{${name}}`));
}

export function getUserErrorMessage(error, fallbackKey = 'unexpectedError') {
  if (error instanceof AppError) {
    return t(error.code, error.parameters);
  }
  return t(fallbackKey);
}

export function getLocale() {
  return locale;
}

export function setLocale(nextLocale, documentRef = document) {
  locale = SUPPORTED_LOCALES.includes(nextLocale) ? nextLocale : 'en';
  documentRef.documentElement.lang = locale;
  for (const element of documentRef.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of documentRef.querySelectorAll('[data-i18n-aria-label]')) {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  }
  for (const element of documentRef.querySelectorAll('[data-i18n-title]')) {
    element.setAttribute('title', t(element.dataset.i18nTitle));
  }
  try {
    localStorage.setItem('carton-builder-locale', locale);
  } catch {
    // The UI still works when storage is unavailable.
  }
  documentRef.dispatchEvent(new CustomEvent('carton-locale-changed', {
    detail: { locale },
  }));
  return locale;
}

export function initializeI18n(documentRef = document) {
  let saved = 'en';
  try {
    saved = localStorage.getItem('carton-builder-locale') || 'en';
  } catch {
    // Keep English as the deterministic default.
  }
  const picker = documentRef.getElementById('localePicker');
  if (picker) {
    picker.value = SUPPORTED_LOCALES.includes(saved) ? saved : 'en';
    picker.addEventListener('change', () => setLocale(picker.value, documentRef));
  }
  return setLocale(saved, documentRef);
}
