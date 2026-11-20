import { z } from 'zod';
import { localizedText, ruleCode } from './common.js';

export const DAILY_REPORT_QUESTION_TYPES = Object.freeze(['text', 'number', 'yes_no']);

/** End-of-day report questions (0–10). */
export const dailyReportSchema = z
  .strictObject({
    required: z.boolean(),
    questions: z
      .array(
        z.strictObject({
          code: ruleCode,
          label: localizedText(),
          type: z.enum(DAILY_REPORT_QUESTION_TYPES),
          required: z.boolean(),
        }),
      )
      .max(10),
  })
  .superRefine((value, ctx) => {
    const seen = new Set();
    value.questions.forEach((question, index) => {
      if (seen.has(question.code)) {
        ctx.addIssue({
          code: 'custom',
          path: ['questions', index, 'code'],
          message: 'Question codes must be unique',
        });
      }
      seen.add(question.code);
    });
  });
