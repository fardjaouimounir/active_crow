// Local copy of the AI service contract (fieldflow-ai/openapi.yaml, `Request` and
// `CallbackResult` schemas) and of its PII firewall. The copy lets the backend validate every
// outbound payload before it leaves; test/aiContract.test.js fails when the YAML changes.
import { z } from 'zod';

export const AI_CAPABILITIES = Object.freeze([
  'supervisor_daily_summary',
  'sales_performance',
  'campaign_insights',
  'animateur_coaching',
]);

/** `subject.type` the AI service requires for each capability. */
export const AI_SUBJECT_TYPES = Object.freeze({
  supervisor_daily_summary: 'supervisor',
  sales_performance: 'campaign',
  campaign_insights: 'campaign',
  animateur_coaching: 'campaign',
});

export const AI_LOCALES = Object.freeze(['ar', 'en']);

export const AI_OUTPUT_ERROR_CODES = Object.freeze(['NEEDS_DATA', 'PII_FIREWALL']);

const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Strict request body of `POST /v1/{capability}`. `data` is free-form but passes the PII guard. */
export const aiServiceRequestSchema = z.strictObject({
  requestId: z.uuid(),
  agencyId: z.uuid(),
  subject: z.strictObject({ type: z.enum(['supervisor', 'campaign']), id: z.string().min(1) }),
  input: z.strictObject({
    text: z.string().nullable().optional(),
    fileUrl: z.url().nullable().optional(),
    context: z.strictObject({
      workDate: businessDate.optional(),
      from: businessDate.optional(),
      to: businessDate.optional(),
      locale: z.enum(AI_LOCALES),
      data: z.record(z.string(), z.unknown()),
    }),
  }),
});

/** Strict body of the callback `POST /api/v1/internal/ai/results`. */
export const aiCallbackSchema = z.strictObject({
  requestId: z.uuid(),
  capability: z.enum(AI_CAPABILITIES),
  modelVersion: z.string().min(1).max(120),
  confidence: z.number().min(0).max(1),
  output: z.record(z.string(), z.unknown()),
});

// --- PII guard: same rules as the AI service's firewall (HANDOFF §5) ---

const FORBIDDEN_KEYS = new Set([
  'name',
  'firstname',
  'lastname',
  'fullname',
  'displayname',
  'phone',
  'mobile',
  'telephone',
  'contact',
  'email',
  'mail',
  'ssn',
  'nationalid',
  'id_number',
  'passport',
  'address',
  'exif',
  'gps',
  'latitude',
  'longitude',
  'photo',
  'image',
  'image_data',
  'file_data',
  'base64',
  'payload',
]);
const PHONE = /(\+?\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL_VALUE = /https?:\/\//;
const BASE64 = /^[A-Za-z0-9+/]{20,}={0,2}$/;
// Stricter than the AI service: its PHONE pattern misses Algerian grouped numbers such as
// "0555 12 34 56". Any string with 8 or more digits (separators ignored) is refused here.
const DIGIT_HEAVY = /(?:\d[\s.()-]*){8,}/;
const MAX_STRING_LENGTH = 200;

/**
 * Every PII problem found in a value (keys and string values, at any depth). Paths only, never the
 * offending value, so the result is safe to log.
 * @param {unknown} value
 * @param {string} [path]
 * @returns {string[]}
 */
export function findPiiProblems(value, path = 'data') {
  if (typeof value === 'string') {
    const problems = [];
    if (value.length > MAX_STRING_LENGTH) problems.push(`${path}: string too long`);
    if (PHONE.test(value)) problems.push(`${path}: phone-shaped value`);
    if (DIGIT_HEAVY.test(value)) problems.push(`${path}: digit-heavy value`);
    if (EMAIL.test(value)) problems.push(`${path}: email-shaped value`);
    if (URL_VALUE.test(value)) problems.push(`${path}: URL`);
    if (BASE64.test(value)) problems.push(`${path}: base64-shaped value`);
    return problems;
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findPiiProblems(item, `${path}[${index}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [
      ...(FORBIDDEN_KEYS.has(key.toLowerCase()) ? [`${path}: forbidden key ${key}`] : []),
      ...findPiiProblems(child, `${path}.${key}`),
    ]);
  }
  return [];
}
