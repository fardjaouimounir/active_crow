import { Router } from 'express';
import { authenticate } from '../../core/auth/index.js';
import { requirePermission } from '../../core/authz/index.js';
import { validate } from '../../core/http/index.js';
import * as controller from './catalog.controller.js';
import * as input from './catalog.validators.js';

const NESTED = [
  {
    path: 'products',
    param: 'productId',
    handlers: controller.products,
    list: input.productList,
    params: input.productParams,
    create: input.createProduct,
    update: input.updateProduct,
  },
  {
    path: 'stock-items',
    param: 'itemId',
    handlers: controller.stockItems,
    list: input.stockItemList,
    params: input.stockItemParams,
    create: input.createStockItem,
    update: input.updateStockItem,
  },
];

/** Clients and their nested catalog, mounted at `/clients`. */
export function createCatalogRouter() {
  const router = Router();
  const read = requirePermission('catalog.read');
  const manage = requirePermission('catalog.manage');
  const query = input.empty;
  const params = input.clientParams;

  router.get(
    '/',
    authenticate,
    read,
    validate({ query: input.clientList }),
    controller.listClients,
  );
  router.post(
    '/',
    authenticate,
    manage,
    validate({ query, body: input.createClient }),
    controller.createClient,
  );
  router.get('/:id', authenticate, read, validate({ query, params }), controller.client);
  router.patch(
    '/:id',
    authenticate,
    manage,
    validate({ query, params, body: input.updateClient }),
    controller.updateClient,
  );
  router.delete(
    '/:id',
    authenticate,
    manage,
    validate({ query, params, body: input.empty }),
    controller.deleteClient,
  );
  router.get(
    '/:id/users',
    authenticate,
    requirePermission('org.user.read'),
    validate({ params, query: input.clientUserList }),
    controller.clientUsers,
  );

  for (const resource of NESTED) {
    const base = '/:id/' + resource.path;
    const item = base + '/:' + resource.param;
    const { handlers } = resource;
    router.get(base, authenticate, read, validate({ params, query: resource.list }), handlers.list);
    router.post(
      base,
      authenticate,
      manage,
      validate({ params, query, body: resource.create }),
      handlers.create,
    );
    router.patch(
      item,
      authenticate,
      manage,
      validate({ params: resource.params, query, body: resource.update }),
      handlers.update,
    );
    router.delete(
      item,
      authenticate,
      manage,
      validate({ params: resource.params, query, body: input.empty }),
      handlers.remove,
    );
  }
  return router;
}
