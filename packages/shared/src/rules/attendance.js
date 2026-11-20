import { z } from 'zod';
import { hhmm, localizedText, ruleCode } from './common.js';

const checkpoint = z.strictObject({
  code: ruleCode,
  label: localizedText(),
  window: z.tuple([hhmm, hhmm]),
  photo: z.boolean(),
  gps: z.boolean(),
});

/** Attendance checkpoints (required for approval). */
export const attendanceSchema = z
  .strictObject({
    checkpoints: z.array(checkpoint).min(1).max(4),
    lateToleranceMinutes: z.int().min(0).max(120),
    autoVerifyAfterHours: z.int().min(1).max(72).nullable(),
    maxDistanceMeters: z.int().min(50).max(5000).nullable(),
  })
  .superRefine((value, ctx) => {
    const seen = new Set();
    value.checkpoints.forEach((item, index) => {
      if (seen.has(item.code)) {
        ctx.addIssue({
          code: 'custom',
          path: ['checkpoints', index, 'code'],
          message: 'Checkpoint codes must be unique',
        });
      }
      seen.add(item.code);
      const [start, end] = item.window;
      if (start >= end) {
        ctx.addIssue({
          code: 'custom',
          path: ['checkpoints', index, 'window', 1],
          message: 'The window must end after it starts',
        });
      }
      const previous = value.checkpoints[index - 1];
      if (previous && item.window[0] <= previous.window[1]) {
        ctx.addIssue({
          code: 'custom',
          path: ['checkpoints', index, 'window', 0],
          message: 'Windows must be in order and must not overlap',
        });
      }
    });
    if (value.checkpoints.some((item) => item.gps) && value.maxDistanceMeters === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxDistanceMeters'],
        message: 'Required when a checkpoint uses GPS',
      });
    }
  });
