import { ScopeService } from '../../core/authz/index.js';
import { catalogService as service } from './catalog.service.js';

const scope = (req) => ScopeService.forRequest(req);

export async function listClients(req, res) {
  res.json(await service.listClients(scope(req), req.query));
}

export async function client(req, res) {
  res.json({ data: await service.clientDetail(scope(req), req.params.id) });
}

export async function createClient(req, res) {
  res.status(201).json({ data: await service.createClient(scope(req), req.actor, req.body) });
}

export async function updateClient(req, res) {
  res.json({
    data: await service.updateClient(scope(req), req.actor, req.params.id, req.body),
  });
}

export async function deleteClient(req, res) {
  await service.deleteClient(scope(req), req.actor, req.params.id);
  res.status(204).end();
}

export async function clientUsers(req, res) {
  res.json(await service.clientUsers(scope(req), req.params.id, req.query));
}

/** Handlers for a resource nested under a client (`products`, `stock-items`). */
function nested({ list, create, update, remove, param }) {
  return {
    list: async (req, res) => {
      res.json(await list(scope(req), req.params.id, req.query));
    },
    create: async (req, res) => {
      const data = await create(scope(req), req.actor, req.params.id, req.body);
      res.status(201).json({ data });
    },
    update: async (req, res) => {
      const data = await update(scope(req), req.actor, req.params.id, req.params[param], req.body);
      res.json({ data });
    },
    remove: async (req, res) => {
      await remove(scope(req), req.actor, req.params.id, req.params[param]);
      res.status(204).end();
    },
  };
}

export const products = nested({
  list: service.listProducts,
  create: service.createProduct,
  update: service.updateProduct,
  remove: service.deleteProduct,
  param: 'productId',
});

export const stockItems = nested({
  list: service.listStockItems,
  create: service.createStockItem,
  update: service.updateStockItem,
  remove: service.deleteStockItem,
  param: 'itemId',
});
