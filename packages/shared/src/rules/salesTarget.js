import { z } from 'zod';
import { perDay } from './common.js';

/** Daily sales target per Animateur, overall and per product. Product ids are checked by the API. */
export const salesTargetSchema = z
  .strictObject({
    dailyUnitsPerAnimateur: perDay,
    perProduct: z.array(z.strictObject({ productId: z.uuid(), dailyUnits: perDay })).max(200),
  })
  .superRefine((value, ctx) => {
    const seen = new Set();
    value.perProduct.forEach((item, index) => {
      if (seen.has(item.productId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['perProduct', index, 'productId'],
          message: 'A product can appear only once',
        });
      }
      seen.add(item.productId);
    });
  });
