import { ERROR_CODES } from '@fieldflow/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LanguageSwitcher } from '../src/shared/i18n/LanguageSwitcher.jsx';
import { NETWORK_ERROR } from '../src/shared/api/client.js';
import { resources } from '../src/shared/i18n/index.js';

/** @param {Record<string, unknown>} value @returns {string[]} */
function keysOf(value, prefix = '') {
  return Object.entries(value).flatMap(([key, child]) =>
    child && typeof child === 'object'
      ? keysOf(/** @type {Record<string, unknown>} */ (child), `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe('language switching', () => {
  it('switching to Arabic sets dir="rtl" and lang="ar" on <html>', async () => {
    render(<LanguageSwitcher />);
    expect(document.documentElement).toHaveAttribute('dir', 'ltr');

    await userEvent.click(screen.getByRole('button', { name: 'العربية' }));

    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(document.documentElement).toHaveAttribute('lang', 'ar');
    expect(screen.getByRole('button', { name: 'العربية' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem('fieldflow.language')).toBe('ar');

    await userEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(document.documentElement).toHaveAttribute('dir', 'ltr');
  });
});

describe('translation resources', () => {
  it('Arabic and English define the same keys in every namespace', () => {
    for (const namespace of Object.keys(resources.en)) {
      expect(keysOf(resources.ar[namespace]).sort()).toEqual(
        keysOf(resources.en[namespace]).sort(),
      );
    }
  });

  it('translate every API error code', () => {
    const codes = Object.keys(resources.en.common.errors.codes).sort();
    expect(codes).toEqual([...Object.values(ERROR_CODES), NETWORK_ERROR].sort());
  });
});
