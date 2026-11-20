// Campaign rule types (FR-033): a fixed list with one strict Zod schema each — not a rule engine.
import { RULE_TYPES } from '../enums.js';
import { attendanceSchema } from './attendance.js';
import { customerFieldsSchema } from './customerFields.js';
import { dailyReportSchema } from './dailyReport.js';
import { salesTargetSchema } from './salesTarget.js';
import { samplingTargetSchema } from './samplingTarget.js';
import { uniformSchema } from './uniform.js';

export { attendanceSchema } from './attendance.js';
export { customerFieldsSchema, CUSTOMER_FIELD_MODES } from './customerFields.js';
export { dailyReportSchema, DAILY_REPORT_QUESTION_TYPES } from './dailyReport.js';
export { salesTargetSchema } from './salesTarget.js';
export { samplingTargetSchema } from './samplingTarget.js';
export { uniformSchema } from './uniform.js';

/** `rule_type` → Zod schema of its config. */
export const RULE_SCHEMAS = Object.freeze({
  attendance: attendanceSchema,
  uniform: uniformSchema,
  sales_target: salesTargetSchema,
  sampling_target: samplingTargetSchema,
  customer_fields: customerFieldsSchema,
  daily_report: dailyReportSchema,
});

/** A rule set cannot be approved without these. */
export const REQUIRED_RULE_TYPES = Object.freeze(['attendance', 'customer_fields']);

/** @param {unknown} type @returns {type is keyof typeof RULE_SCHEMAS} */
export const isRuleType = (type) => RULE_TYPES.includes(type);

/**
 * Validates one rule config. Issue paths are dotted (`checkpoints.0.window.1`), relative to the
 * config, so editors can highlight the exact field.
 * @param {string} type
 * @param {unknown} config
 * @returns {{ success: true, data: any } | { success: false, issues: Array<{ path: string, message: string }> }}
 */
export function validateRuleConfig(type, config) {
  if (!isRuleType(type)) {
    return { success: false, issues: [{ path: '', message: 'Unknown rule type' }] };
  }
  const result = RULE_SCHEMAS[type].safeParse(config);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
