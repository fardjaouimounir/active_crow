import { z } from 'zod';

const DEFAULTS = {
  AI_SERVICE_INBOUND_KEY: 'replace-me-inbound',
  AI_SERVICE_OUTBOUND_KEY: 'replace-me-outbound',
  FIELDFLOW_API_BASE_URL: 'http://localhost:3000',
  LLM_BASE_URL: 'https://app.ai-grid.io/v1',
  LLM_API_KEY: 'replace-me-ai-grid-key',
  LLM_MODEL: 'Qwen/Qwen3.8-27B',
  LLM_JSON_MODE: 'false',
  LLM_TEMPERATURE: '0.2',
  LLM_MAX_TOKENS: '16000',
  LLM_TIMEOUT_MS: '60000',
  CALLBACK_TIMEOUT_MS: '10000',
  PORT: '4100',
  LOG_LEVEL: 'info',
  OUTPUT_MODE: 'claims',
};

// Placeholder markers that must never reach production.
const PLACEHOLDER_PREFIX = 'replace-me-';

function isPlaceholder(value) {
  return typeof value !== 'string' || value.startsWith(PLACEHOLDER_PREFIX) || value.length === 0;
}

const EnvSchema = z
  .object({
    AI_SERVICE_INBOUND_KEY: z.string().default(DEFAULTS.AI_SERVICE_INBOUND_KEY),
    AI_SERVICE_OUTBOUND_KEY: z.string().default(DEFAULTS.AI_SERVICE_OUTBOUND_KEY),
    FIELDFLOW_API_BASE_URL: z.string().url().default(DEFAULTS.FIELDFLOW_API_BASE_URL),
    LLM_BASE_URL: z.string().url().default(DEFAULTS.LLM_BASE_URL),
    LLM_API_KEY: z.string().default(DEFAULTS.LLM_API_KEY),
    LLM_MODEL: z.string().min(1).default(DEFAULTS.LLM_MODEL),
    LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(parseFloat(DEFAULTS.LLM_TEMPERATURE)),
    LLM_JSON_MODE: z.enum(['true', 'false']).default(DEFAULTS.LLM_JSON_MODE),
    LLM_MAX_TOKENS: z.coerce.number().int().positive().default(parseInt(DEFAULTS.LLM_MAX_TOKENS, 10)),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(parseInt(DEFAULTS.LLM_TIMEOUT_MS, 10)),
    CALLBACK_TIMEOUT_MS: z.coerce.number().int().positive().default(parseInt(DEFAULTS.CALLBACK_TIMEOUT_MS, 10)),
    PORT: z.coerce.number().int().positive().default(parseInt(DEFAULTS.PORT, 10)),
    LOG_LEVEL: z.string().default(DEFAULTS.LOG_LEVEL),
    // claims: the model writes typed claims about code-detected findings (default).
    // legacy: the model writes the report fields directly (rollback switch).
    OUTPUT_MODE: z.enum(['claims', 'legacy']).default(DEFAULTS.OUTPUT_MODE),
  })
  .refine(
    (data) => !isPlaceholder(data.AI_SERVICE_INBOUND_KEY) || process.env.NODE_ENV !== 'production',
    { message: 'AI_SERVICE_INBOUND_KEY must be set in production', path: ['AI_SERVICE_INBOUND_KEY'] },
  )
  .refine(
    (data) => !isPlaceholder(data.AI_SERVICE_OUTBOUND_KEY) || process.env.NODE_ENV !== 'production',
    { message: 'AI_SERVICE_OUTBOUND_KEY must be set in production', path: ['AI_SERVICE_OUTBOUND_KEY'] },
  )
  .refine(
    (data) => !isPlaceholder(data.LLM_API_KEY) || process.env.NODE_ENV !== 'production',
    { message: 'LLM_API_KEY must be set in production', path: ['LLM_API_KEY'] },
  );

export const config = EnvSchema.parse(process.env);

// Fail fast if a placeholder secret leaked into a non-test run.
export function assertSecrets() {
  if (process.env.NODE_ENV === 'test') return;
  for (const [key, value] of Object.entries({
    AI_SERVICE_INBOUND_KEY: config.AI_SERVICE_INBOUND_KEY,
    AI_SERVICE_OUTBOUND_KEY: config.AI_SERVICE_OUTBOUND_KEY,
    LLM_API_KEY: config.LLM_API_KEY,
  })) {
    if (isPlaceholder(value)) {
      throw new Error(`Unconfigured secret ${key}: placeholder value detected. Set a real key or use NODE_ENV=test.`);
    }
  }
}

export const CALLBACK_PATH = '/api/v1/internal/ai/results';
export const CALLBACK_URL = `${config.FIELDFLOW_API_BASE_URL.replace(/\/$/, '')}${CALLBACK_PATH}`;

export const CAPABILITIES = [
  'supervisor_daily_summary',
  'sales_performance',
  'campaign_insights',
  'animateur_coaching',
];
