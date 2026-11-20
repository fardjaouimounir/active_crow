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
    // HS256 key for access tokens. Generate one with:
    // node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    ACCESS_TOKEN_TTL: z
      .string()
      .regex(/^d+[smh]$/, 'must look like 900s, 15m or 1h')
      .default('15m')
      .transform(toSeconds)
      .pipe(z.number().int().min(60).max(86_400)),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    // Unset: Secure cookies everywhere except development (plain http://localhost).
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === 'true')),
  })
  .refine((env) => env.NODE_ENV !== 'test' || env.DATABASE_URL_TEST, {
    path: ['DATABASE_URL_TEST'],
    message: 'is required when NODE_ENV=test',
  })
  .transform((env) => ({
    ...env,
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV !== 'development',
  }));

const UNIT_SECONDS = { s: 1, m: 60, h: 3600 };

/** '15m' → 900 */
function toSeconds(value) {
  return Number(value.slice(0, -1)) * UNIT_SECONDS[value.at(-1)];
}

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
