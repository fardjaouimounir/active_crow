import { z } from 'zod';
import { localizedText } from './common.js';

/** Uniform requirements. */
export const uniformSchema = z.strictObject({
  required: z.boolean(),
  description: localizedText(500).nullable(),
});
