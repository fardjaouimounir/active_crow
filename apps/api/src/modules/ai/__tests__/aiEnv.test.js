import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../../config/env.js';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DATABASE_URL_TEST: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'j'.repeat(40),
};
const key = (char) => char.repeat(40);

describe('AI service configuration', () => {
  it('is optional: an empty base URL disables the module', () => {
    expect(parseEnv(base).success).toBe(true);
    const blank = parseEnv({ ...base, AI_SERVICE_BASE_URL: '', AI_SERVICE_INBOUND_KEY: '' });
    expect(blank).toMatchObject({ success: true });
    expect(blank.data.AI_SERVICE_BASE_URL).toBeUndefined();
  });

  it('needs two keys of at least 32 characters when the base URL is set', () => {
    const enabled = { ...base, AI_SERVICE_BASE_URL: 'http://localhost:4100' };
    expect(parseEnv(enabled)).toMatchObject({ success: false });
    expect(
      parseEnv({ ...enabled, AI_SERVICE_INBOUND_KEY: 'short', AI_SERVICE_OUTBOUND_KEY: key('b') }),
    ).toMatchObject({ success: false });
    expect(
      parseEnv({ ...enabled, AI_SERVICE_INBOUND_KEY: key('a'), AI_SERVICE_OUTBOUND_KEY: key('b') }),
    ).toMatchObject({ success: true });
  });

  it('the two keys must differ', () => {
    const same = parseEnv({
      ...base,
      AI_SERVICE_BASE_URL: 'http://localhost:4100',
      AI_SERVICE_INBOUND_KEY: key('a'),
      AI_SERVICE_OUTBOUND_KEY: key('a'),
    });
    expect(same).toMatchObject({ success: false });
  });

  it('refuses placeholder keys in production', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      AI_SERVICE_BASE_URL: 'http://ai:4100',
      AI_SERVICE_OUTBOUND_KEY: key('b'),
    };
    expect(
      parseEnv({ ...production, AI_SERVICE_INBOUND_KEY: 'replace-me-' + 'x'.repeat(30) }),
    ).toMatchObject({ success: false });
    expect(parseEnv({ ...production, AI_SERVICE_INBOUND_KEY: key('a') })).toMatchObject({
      success: true,
    });
  });
});
