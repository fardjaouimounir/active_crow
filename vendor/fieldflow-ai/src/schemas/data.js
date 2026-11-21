import { z } from 'zod';

// Typed shape of `input.context.data` per capability. WARN-ONLY: the request
// contract stays `record<unknown>`; nothing is rejected here. A value of the
// wrong type is reported as a NONNUMERIC data-quality finding and the field is
// treated as missing by the KPI code. Unknown extra keys are tolerated.

const Num = z.number().finite().nullable().optional();
const Label = z.string().optional();
const block = (shape) => z.object(shape).passthrough().optional();

export const DataSchemas = {
  supervisor_daily_summary: z.object({
    attendance: block({ present: Num, expected: Num }),
    sales: block({ units: Num, previousUnits: Num }),
    gifts: block({ distributed: Num, planned: Num }),
  }).passthrough(),
  sales_performance: z.object({
    sellers: z.array(z.object({ label: Label, units: Num, target: Num }).passthrough()).optional(),
    periods: z.array(z.object({ label: Label, units: Num }).passthrough()).optional(),
  }).passthrough(),
  campaign_insights: z.object({
    attendance: block({ present: Num, expected: Num }),
    sales: block({ units: Num, target: Num }),
    gifts: block({ distributed: Num, planned: Num }),
  }).passthrough(),
  animateur_coaching: z.object({
    animateurs: z.array(z.object({ label: Label, attendanceRate: Num, units: Num, target: Num, visits: Num }).passthrough()).optional(),
  }).passthrough(),
};

// Returns the field paths whose value has the wrong type (empty when the shape is fine).
export function dataShapeIssues(capability, data) {
  const schema = DataSchemas[capability];
  if (!schema) return [];
  const result = schema.safeParse(data ?? {});
  if (result.success) return [];
  return [...new Set(result.error.issues.map((i) => i.path.join('.')))];
}
