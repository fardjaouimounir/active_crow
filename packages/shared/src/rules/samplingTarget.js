import { z } from 'zod';
import { perDay } from './common.js';

/** Daily sampling target; `stockItemId` must be a sample of the client (checked by the API). */
export const samplingTargetSchema = z.strictObject({
  dailySamplesPerAnimateur: perDay,
  stockItemId: z.uuid(),
});
