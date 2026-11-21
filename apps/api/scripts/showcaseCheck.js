// Opt-in, slow (several minutes): runs the full-size showcase checks (closed campaign, report,
// calibration of the patterns) on the test database. Never part of `npm run verify`.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apiDir = fileURLToPath(new URL('..', import.meta.url));
const result = spawnSync(
  process.execPath,
  [fileURLToPath(import.meta.resolve('vitest/vitest.mjs')), 'run', 'test/showcase.full.test.js'],
  { cwd: apiDir, stdio: 'inherit', env: { ...process.env, SHOWCASE_CHECK: '1' } },
);
process.exitCode = result.status ?? 1;
