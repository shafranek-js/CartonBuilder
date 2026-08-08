import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/errors.js';
import {
  getUserErrorMessage,
  setLocale,
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

describe('localized errors', () => {
  it('translates known error codes and hides internal messages', () => {
    setLocale('ru', documentStub());
    expect(getUserErrorMessage(new AppError('artworkFileEmpty'))).toBe('Файл макета пуст.');
    expect(getUserErrorMessage(new AppError('renderEnvironmentTooLarge'))).toBe(
      'Размер карты окружения не должен превышать 128 МиБ.',
    );
    expect(getUserErrorMessage(new Error('private internal detail'), 'artworkLoadFailed')).toBe(
      'Не удалось загрузить макет.',
    );
  });
});
