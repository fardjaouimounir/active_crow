// Loads apps/api/.env (if present) and validates the environment once at startup.
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// LOG_LEVEL as set by the caller (shell, CI, vitest), before apps/api/.env fills the gaps.
const explicitLogLevel = process.env.LOG_LEVEL;

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

const postgresUrl = z
  .url()
  .refine((value) => /^postgres(ql)?:\/\//.test(value), 'must be a postgresql:// URL');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url()).min(1)),
    DATABASE_URL: postgresUrl,
    DATABASE_URL_TEST: postgresUrl.optional(),
  })
  .refine((env) => env.NODE_ENV !== 'test' || env.DATABASE_URL_TEST, {
    path: ['DATABASE_URL_TEST'],
    message: 'is required when NODE_ENV=test',
  });

/**
 * @param {NodeJS.ProcessEnv} source
 * @returns {{ success: true, data: Env } | { success: false, problems: string[] }}
 */
export function parseEnv(source) {
  const result = envSchema.safeParse(source);
  if (result.success) return { success: true, data: result.data };
  const problems = result.error.issues.map(
    (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );
  return { success: false, problems };
}

/** @typedef {z.infer<typeof envSchema>} Env */

// Tests are silent unless the caller asks for logs (e.g. `LOG_LEVEL=debug npm test`);
// a LOG_LEVEL coming only from apps/api/.env does not count.
const source =
  process.env.NODE_ENV === 'test' && explicitLogLevel === undefined
    ? { ...process.env, LOG_LEVEL: 'silent' }
    : process.env;
const parsed = parseEnv(source);
if (!parsed.success) {
  // The logger depends on this config, so report directly to stderr and stop.
  process.stderr.write(
    `Invalid environment configuration:\n${parsed.problems.map((p) => `  - ${p}`).join('\n')}\n` +
      'See apps/api/.env.example for the expected variables.\n',
  );
  process.exit(1);
}

/** @type {Readonly<Env>} */
export const env = Object.freeze(parsed.data);
