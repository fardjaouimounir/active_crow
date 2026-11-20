// Runs once before the API test suite: applies all migrations to the test database.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { TEST_UPLOAD_DIR } from '../vitest.config.js';

const apiDir = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const prismaCli = join(dirname(require.resolve('prisma/package.json')), 'build', 'index.js');

export default function setup() {
  // Read apps/api/.env into a local object: writing it into process.env here would leak into every
  // test worker (e.g. LOG_LEVEL=info would count as "explicitly set" and un-silence the logs).
  const fileEnv = {};
  dotenv.config({ path: join(apiDir, '.env'), quiet: true, processEnv: fileEnv });
  const url = process.env.DATABASE_URL_TEST ?? fileEnv.DATABASE_URL_TEST;
  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST is required to run the API tests (see apps/api/.env.example).',
    );
  }

  try {
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });
  } catch (err) {
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`.replaceAll(url, '<DATABASE_URL_TEST>');
    throw new Error(`prisma migrate deploy failed on the test database:\n${output}`, {
      cause: err,
    });
  }

  // Teardown: remove the temporary upload directory of this run.
  return () => {
    rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
  };
}
