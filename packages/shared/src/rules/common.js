import { z } from 'zod';

export const localizedText = (max = 120) =>
  z.strictObject({ ar: z.string().trim().min(1).max(max), en: z.string().trim().min(1).max(max) });

export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24 h)');
export const ruleCode = z.string().regex(/^[a-z][a-z_]{1,29}$/, 'Lower-case letters and _ (2–30)');
export const perDay = z.int().min(1).max(10000);
