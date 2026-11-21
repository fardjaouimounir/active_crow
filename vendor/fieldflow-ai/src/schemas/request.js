import { z } from 'zod';

export const CapabilitySchema = z.enum([
  'supervisor_daily_summary',
  'sales_performance',
  'campaign_insights',
  'animateur_coaching',
]);

export const SubjectSchema = z
  .object({
    type: z.enum(['supervisor', 'campaign']),
    id: z.string().min(1),
  })
  .strict();

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const ContextSchema = z
  .object({
    workDate: DateString.optional(),
    from: DateString.optional(),
    to: DateString.optional(),
    locale: z.enum(['ar', 'en']),
    data: z.record(z.unknown()),
  })
  .strict();

export const RequestSchema = z
  .object({
    requestId: z.string().uuid(),
    agencyId: z.string().uuid(),
    subject: SubjectSchema,
    input: z
      .object({
        text: z.string().nullable().optional(),
        fileUrl: z.string().url().nullable().optional(),
        context: ContextSchema,
      })
      .strict(),
  })
  .strict();

export const CallbackSchema = z
  .object({
    requestId: z.string().uuid(),
    capability: CapabilitySchema,
    modelVersion: z.string().min(1),
    confidence: z.number().min(0).max(1),
    output: z.unknown(),
  })
  .strict();

export function parseRequest(body) {
  return RequestSchema.parse(body);
}
