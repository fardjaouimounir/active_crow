import { algerianPhoneSchema } from '@fieldflow/shared';
import { z } from 'zod';

const text = (max) => z.string().trim().min(1).max(max);
const wilaya = z.int().min(1).max(32767);
const integer = (max) => z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(1).max(max));

export const params = z.strictObject({ id: z.uuid() });
export const empty = z.strictObject({});
export const region = z.strictObject({ name: text(150), code: text(40) });
export const regionPatch = region.partial().refine((value) => Object.keys(value).length > 0);
export const wilayas = z.strictObject({
  wilayaIds: z
    .array(wilaya)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
});

const point = z.strictObject({
  code: text(40),
  name: text(150),
  type: text(80),
  wilayaId: wilaya,
  communeId: z.int().positive().nullish(),
  address: text(500).nullish(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  contactName: text(200).nullish(),
  contactPhone: algerianPhoneSchema.nullish(),
});

const both = (value) =>
  (value.latitude == null) === (value.longitude == null) &&
  (value.latitude === undefined) === (value.longitude === undefined);
const coordinates = { path: ['longitude'], message: 'Provide both coordinates, or clear both' };

export const createPoint = point.refine(
  (value) => (value.latitude == null) === (value.longitude == null),
  coordinates,
);
export const updatePoint = point
  .partial()
  .extend({ version: z.int().positive() })
  .refine(both, coordinates);
export const points = z.strictObject({
  wilayaId: integer(32767).optional(),
  communeId: integer(2147483647).optional(),
  type: text(80).optional(),
  q: z.string().trim().max(200).optional(),
  page: integer(1000000).default(1),
  pageSize: integer(100).default(25),
  sort: z.enum(['name:asc', 'name:desc', 'code:asc', 'code:desc']).default('name:asc'),
});
