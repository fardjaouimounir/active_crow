import { z } from 'zod';

export {
  createRegionSchema as region,
  updateRegionSchema as regionPatch,
  regionWilayasSchema as wilayas,
  createPointSchema as createPoint,
  updatePointSchema as updatePoint,
} from '@fieldflow/shared';

const text = (max) => z.string().trim().min(1).max(max);
const integer = (max) => z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(1).max(max));

export const params = z.strictObject({ id: z.uuid() });
export const empty = z.strictObject({});
export const points = z.strictObject({
  wilayaId: integer(32767).optional(),
  communeId: integer(2147483647).optional(),
  type: text(80).optional(),
  q: z.string().trim().max(200).optional(),
  page: integer(1000000).default(1),
  pageSize: integer(100).default(25),
  sort: z.enum(['name:asc', 'name:desc', 'code:asc', 'code:desc']).default('name:asc'),
});
