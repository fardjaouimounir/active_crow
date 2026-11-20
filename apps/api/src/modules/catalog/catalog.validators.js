import { STOCK_ITEM_KINDS } from '@fieldflow/shared';
import { z } from 'zod';

export {
  createClientSchema as createClient,
  updateClientSchema as updateClient,
  createProductSchema as createProduct,
  updateProductSchema as updateProduct,
  createStockItemSchema as createStockItem,
  updateStockItemSchema as updateStockItem,
} from '@fieldflow/shared';

const integer = (max) => z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(1).max(max));
const paging = {
  page: integer(1000000).default(1),
  pageSize: integer(100).default(25),
};
const sort = (fields, fallback) =>
  z.enum(fields.flatMap((field) => [field + ':asc', field + ':desc'])).default(fallback);

export const empty = z.strictObject({});
export const clientParams = z.strictObject({ id: z.uuid() });
export const productParams = z.strictObject({ id: z.uuid(), productId: z.uuid() });
export const stockItemParams = z.strictObject({ id: z.uuid(), itemId: z.uuid() });

export const clientList = z.strictObject({
  q: z.string().trim().max(200).optional(),
  sort: sort(['name', 'createdAt'], 'name:asc'),
  ...paging,
});
export const productList = z.strictObject({
  sort: sort(['sku', 'name', 'createdAt'], 'name:asc'),
  ...paging,
});
export const stockItemList = z.strictObject({
  kind: z.enum(STOCK_ITEM_KINDS).optional(),
  sort: sort(['sku', 'name', 'createdAt'], 'name:asc'),
  ...paging,
});
export const clientUserList = z.strictObject({ ...paging });
