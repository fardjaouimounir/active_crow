import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parseShowcaseOptions } from '../prisma/seed/showcaseOptions.js';

const cli = fileURLToPath(new URL('../prisma/seed/showcase.js', import.meta.url));

it('rejects unknown options before opening the database or resetting', () => {
  const result = spawnSync(process.execPath, [cli, '--refresh'], { encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Unknown showcase argument: --refresh');
  expect(result.stdout).not.toContain('Resetting the demo database');
});

it('requires the exact RESET response for the confirmed reset', () => {
  const result = spawnSync(process.execPath, [cli, '--confirm-reset'], {
    encoding: 'utf8',
    input: 'reset\n',
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('Type RESET to continue');
  expect(result.stderr).toContain('Showcase reset cancelled');
});

it('recognizes refresh-today and rejects mixing it with reset confirmation', () => {
  expect(parseShowcaseOptions(['--refresh-today'])).toMatchObject({ refreshToday: true });
  expect(parseShowcaseOptions(['--confirm-reset', '--tiny'])).toMatchObject({
    confirmReset: true,
    tiny: true,
    refreshToday: false,
  });
  expect(() => parseShowcaseOptions(['--refresh-today', '--confirm-reset'])).toThrow(
    'either a reset',
  );
});
