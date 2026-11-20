import * as schema from '@fieldflow/shared';
import { z } from 'zod';

export const params = z.strictObject({ id: z.uuid() });
export const movementParams = z.strictObject({ movementId: z.uuid() });
export const empty = z.strictObject({});

/** In a multipart form `lines` is a JSON string; parse it before the shared schema runs. */
const withJsonLines = (body) =>
  z.preprocess((value) => {
    if (!value || typeof value.lines !== 'string') return value;
    try {
      return { ...value, lines: JSON.parse(value.lines) };
    } catch {
      return { ...value, lines: null };
    }
  }, body);

export const stockInInput = withJsonLines(schema.stockInBody);
export const adjustmentInput = withJsonLines(schema.adjustmentBody);
