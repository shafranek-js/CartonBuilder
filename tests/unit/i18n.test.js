import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/errors.js';
import {
  SUPPORTED_LOCALES,
  getUserErrorMessage,
  messages,
  setLocale,
  t,
} from '../../src/i18n.js';

function documentStub() {
  return {
    documentElement: {},
    querySelectorAll: () => [],
    dispatchEvent: vi.fn(),
  };
}

afterEach(() => {
  setLocale('en', documentStub());
});

describe('i18n dictionary parity across all supported languages', () => {
  it('exports SUPPORTED_LOCALES including en, uk, cs, de, ru', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'uk', 'cs', 'de', 'ru']);
  });

  it('has identical keys in all supported language dictionaries', () => {
    const enKeys = Object.keys(messages.en).sort();
    expect(enKeys.length).toBe(798);

    for (const lang of ['ru', 'uk', 'cs', 'de']) {
      const langKeys = Object.keys(messages[lang]).sort();
      const missing = enKeys.filter((key) => !(key in messages[lang]));
      const extra = langKeys.filter((key) => !(key in messages.en));

      expect(missing, `Missing keys in ${lang}`).toEqual([]);
      expect(extra, `Extra keys in ${lang}`).toEqual([]);
      expect(langKeys.length, `Key count for ${lang}`).toBe(798);
    }
  });

  it('covers all data-i18n attributes present in index.html across all supported languages', () => {
    const htmlPath = path.resolve(__dirname, '../../index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    const i18nKeys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
    const titleKeys = [...html.matchAll(/data-i18n-title="([^"]+)"/g)].map((m) => m[1]);
    const ariaKeys = [...html.matchAll(/data-i18n-aria-label="([^"]+)"/g)].map((m) => m[1]);

    const allKeys = [...new Set([...i18nKeys, ...titleKeys, ...ariaKeys])];

    for (const lang of SUPPORTED_LOCALES) {
      const missing = allKeys.filter((key) => !(key in messages[lang]));
      expect(missing, `Missing DOM keys in ${lang}`).toEqual([]);
    }
  });

  it('has localePicker options in index.html matching SUPPORTED_LOCALES order with RU after DE', () => {
    const htmlPath = path.resolve(__dirname, '../../index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const selectMatch = html.match(/<select id="localePicker"[^>]*>([\s\S]*?)<\/select>/);
    expect(selectMatch).toBeTruthy();
    const options = [...selectMatch[1].matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)].map((m) => m[1]);
    expect(options).toEqual(['en', 'uk', 'cs', 'de', 'ru']);
  });
});

describe('localized errors across all supported languages', () => {
  it('translates known error codes in Russian', () => {
    setLocale('ru', documentStub());
    expect(getUserErrorMessage(new AppError('artworkFileEmpty'))).toBe('Файл макета пуст.');
    expect(getUserErrorMessage(new AppError('renderEnvironmentTooLarge'))).toBe(
      'Размер карты окружения не должен превышать 128 МиБ.',
    );
    expect(getUserErrorMessage(new AppError('prepressBlocked'))).toBe(
      'Допечатный экспорт заблокирован.',
    );
    expect(getUserErrorMessage(new Error('private internal detail'), 'artworkLoadFailed')).toBe(
      'Не удалось загрузить макет.',
    );
  });

  it('translates known error codes in Ukrainian', () => {
    setLocale('uk', documentStub());
    expect(getUserErrorMessage(new AppError('artworkFileEmpty'))).toBe('Файл макета порожній.');
    expect(getUserErrorMessage(new AppError('renderEnvironmentTooLarge'))).toBe(
      'Розмір карти оточення не повинен перевищувати 128 МіБ.',
    );
    expect(getUserErrorMessage(new AppError('prepressBlocked'))).toBe(
      'Додрукарський експорт заблоковано.',
    );
  });

  it('translates known error codes in Czech', () => {
    setLocale('cs', documentStub());
    expect(getUserErrorMessage(new AppError('artworkFileEmpty'))).toBe('Soubor grafiky je prázdný.');
    expect(getUserErrorMessage(new AppError('renderEnvironmentTooLarge'))).toBe(
      'Velikost mapy prostředí je omezena na 128 MiB.',
    );
    expect(getUserErrorMessage(new AppError('prepressBlocked'))).toBe(
      'Předtiskový export je zablokován.',
    );
  });

  it('translates known error codes in German', () => {
    setLocale('de', documentStub());
    expect(getUserErrorMessage(new AppError('artworkFileEmpty'))).toBe('Die Layout-Datei ist leer.');
    expect(getUserErrorMessage(new AppError('renderEnvironmentTooLarge'))).toBe(
      'Umgebungskarten sind auf 128 MiB begrenzt.',
    );
    expect(getUserErrorMessage(new AppError('prepressBlocked'))).toBe(
      'Druckvorstufen-Export ist blockiert.',
    );
  });
});
