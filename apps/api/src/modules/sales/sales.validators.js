import { saleItems, saleCustomer, today, tombolaInput } from '@fieldflow/shared';
import { z } from 'zod';

export const params = z.strictObject({ id: z.uuid() });
export const empty = z.strictObject({});
const parse = (value) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};
export const saleBody = z.strictObject({
  items: z.preprocess(parse, saleItems),
  customer: z.preprocess(parse, saleCustomer.optional()),
  invoiceRef: z.string().trim().min(1).max(60).optional(),
});
const paging = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
};
export const saleQuery = z
  .strictObject({
    ...paging,
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    sort: z.enum(['soldAt', '-soldAt']).default('-soldAt'),
    animateurId: z.uuid().optional(),
    supervisorId: z.uuid().optional(),
    pointOfSaleId: z.uuid().optional(),
    productId: z.uuid().optional(),
    status: z.enum(['recorded', 'voided']).optional(),
    hasUndelivered: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .transform(({ from, to, ...filters }) => {
    const end = to ?? today();
    return {
      ...filters,
      to: end,
      from: from ?? new Date(+new Date(end) - 30 * 86_400_000).toISOString().slice(0, 10),
    };
  })
  .refine(({ from, to }) => from <= to && +new Date(to) - +new Date(from) < 62 * 86_400_000, {
    path: ['from'],
    message: 'Date range must be 1–62 days',
  });
export const entriesQuery = z.strictObject({
  ...paging,
  status: z.enum(['valid', 'excluded']).optional(),
  number: z.coerce.number().int().min(1).max(2147483647).optional(),
});
export const tombolaPatch = tombolaInput.partial().refine((body) => Object.keys(body).length > 0);
