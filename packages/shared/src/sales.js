import { z } from 'zod';

export const saleReason = z.strictObject({ reason: z.string().trim().min(3).max(300) });
export const fieldInteraction = z.strictObject({
  kind: z.enum(['sample', 'tasting', 'information']),
  count: z.int().min(1).max(500),
});
export const saleItems = z
  .array(
    z.strictObject({
      productId: z.uuid(),
      quantity: z.int().min(1).max(1000),
    }),
  )
  .min(1)
  .max(20)
  .refine(
    (items) => new Set(items.map(({ productId }) => productId.toLowerCase())).size === items.length,
    { message: 'Products must be unique' },
  );
export const saleCustomer = z.strictObject({
  fullName: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .refine((name) => !name.includes(String.fromCharCode(0)))
    .optional(),
  phone: z.string().trim().min(1).max(40).optional(),
  consentTombola: z.boolean().optional(),
});
export const tombolaInput = z.strictObject({
  name: z.string().trim().min(2).max(120),
  entryBasis: z.enum(['per_sale', 'per_unit']),
  entriesPerBasis: z.int().min(1).max(10),
  maxEntriesPerCustomer: z.int().min(1).max(1000).nullable(),
  requiresPurchase: z.literal(true),
  registrationEndsAt: z.iso.datetime({ offset: true }),
  drawScheduledAt: z.iso.datetime({ offset: true }),
  winnersCount: z.int().min(1).max(100),
  reservesCount: z.int().min(0).max(100),
});
