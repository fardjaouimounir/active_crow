// Catalog (M2, FR-020…FR-022): clients, their products, and the gifts and samples they supply
// (Q-13). Reference data is soft-deleted only, and refused while in use (BR-03 spirit).
import { ERROR_CODES } from '@fieldflow/shared';
import { auditService } from '../../core/audit/index.js';
import { AppError, ConflictError, NotFoundError } from '../../core/errors/index.js';
import { clock } from '../../core/time/clock.js';
import { prisma } from '../../db/client.js';
import { withTransaction } from '../../db/transaction.js';
import { userManagementService } from '../organization/userManagement.service.js';
import { usersService } from '../organization/users.service.js';
import * as repository from './catalog.repository.js';

const error = (code, message, status = 422) => new AppError({ code, message, status });
const uniqueConstraints = {
  clients_agency_name_active: [ERROR_CODES.CLIENT_NAME_TAKEN, 'This client name is already used'],
  products_client_id_sku_key: [ERROR_CODES.SKU_TAKEN, 'This SKU is already used by the client'],
  stock_items_client_id_sku_key: [ERROR_CODES.SKU_TAKEN, 'This SKU is already used by the client'],
};

/** Writes run serializable, so an "in use" check and the delete it guards cannot interleave. */
async function write(work) {
  try {
    return await withTransaction(work, { isolationLevel: 'Serializable' });
  } catch (err) {
    const unique = uniqueConstraints[err.details?.constraint];
    if (unique) throw error(...unique, 409);
    if (
      err.code === 'P2034' ||
      err.cause?.originalCode === '40001' ||
      err.meta?.driverAdapterError?.cause?.originalCode === '40001'
    ) {
      throw new ConflictError();
    }
    throw err;
  }
}

function audit(tx, actor, entityType, action, before, after) {
  /** Counts are derived, not part of the audited record. */
  const strip = (row) =>
    row && Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'counts'));
  return auditService.record(tx, {
    actor,
    action: 'catalog.' + entityType + '_' + action,
    entityType,
    entityId: (after ?? before).id,
    before: strip(before),
    after: strip(after),
  });
}

async function required(record) {
  const row = await record;
  if (!row) throw new NotFoundError();
  return row;
}

const client = (db, scope, id) => required(repository.findClient(db, scope, id));

async function withPortalUsers(scope, clients) {
  const counts = await usersService.countByClient(
    scope,
    clients.map(({ id }) => id),
  );
  return clients.map((row) => ({
    ...row,
    counts: { ...row.counts, portalUsers: counts[row.id] ?? 0 },
  }));
}

async function listClients(scope, query) {
  const result = await repository.listClients(scope, query);
  return { ...result, data: await withPortalUsers(scope, result.data) };
}

async function clientDetail(scope, id) {
  const [row] = await withPortalUsers(scope, [await client(prisma, scope, id)]);
  return row;
}

function createClient(scope, actor, data) {
  return write(async (tx) => {
    const after = await repository.createClient(tx, scope, data);
    await audit(tx, actor, 'client', 'created', undefined, after);
    return { ...after, counts: { ...after.counts, portalUsers: 0 } };
  });
}

/** Clients carry no `version`: last write wins, and the audit row keeps both states. */
async function updateClient(scope, actor, id, data) {
  const after = await write(async (tx) => {
    const before = await client(tx, scope, id);
    const row = await repository.updateClient(tx, scope, id, data);
    await audit(tx, actor, 'client', 'updated', before, row);
    return row;
  });
  const [row] = await withPortalUsers(scope, [after]);
  return row;
}

/** Refused while a campaign of the client is not closed or cancelled; suspends its portal users. */
function deleteClient(scope, actor, id) {
  return write(async (tx) => {
    const before = await client(tx, scope, id);
    if (await repository.clientInUse(tx, scope, id)) {
      throw error(ERROR_CODES.CLIENT_IN_USE, 'The client has a campaign that is not closed');
    }
    await repository.updateClient(tx, scope, id, { deletedAt: clock.now() });
    const suspendedUsers = await userManagementService.suspendClientUsers(tx, scope, actor, id);
    await audit(tx, actor, 'client', 'deleted', before, { id, suspendedUsers });
  });
}

async function listProducts(scope, clientId, query) {
  await client(prisma, scope, clientId);
  return repository.listProducts(scope, clientId, query);
}

function createProduct(scope, actor, clientId, data) {
  return write(async (tx) => {
    await client(tx, scope, clientId);
    const after = await repository.createProduct(tx, scope, clientId, data);
    await audit(tx, actor, 'product', 'created', undefined, after);
    return after;
  });
}

function updateProduct(scope, actor, clientId, id, data) {
  return write(async (tx) => {
    await client(tx, scope, clientId);
    const before = await required(repository.findProduct(tx, scope, clientId, id));
    const after = await repository.updateProduct(tx, scope, clientId, id, data);
    await audit(tx, actor, 'product', 'updated', before, after);
    return after;
  });
}

function deleteProduct(scope, actor, clientId, id) {
  return write(async (tx) => {
    await client(tx, scope, clientId);
    const before = await required(repository.findProduct(tx, scope, clientId, id));
    if (await repository.productInUse(tx, scope, id)) {
      throw error(ERROR_CODES.PRODUCT_IN_USE, 'The product is linked to an unfinished campaign');
    }
    await repository.updateProduct(tx, scope, clientId, id, { deletedAt: clock.now() });
    await audit(tx, actor, 'product', 'deleted', before);
  });
}

async function listStockItems(scope, clientId, query) {
  await client(prisma, scope, clientId);
  return repository.listStockItems(scope, clientId, query);
}

function createStockItem(scope, actor, clientId, data) {
  return write(async (tx) => {
    await client(tx, scope, clientId);
    const after = await repository.createStockItem(tx, scope, clientId, data);
    await audit(tx, actor, 'stock_item', 'created', undefined, after);
    return after;
  });
}

function updateStockItem(scope, actor, clientId, id, data) {
  return write(async (tx) => {
    await client(tx, scope, clientId);
    const before = await required(repository.findStockItem(tx, scope, clientId, id));
    const after = await repository.updateStockItem(tx, scope, clientId, id, data);
    await audit(tx, actor, 'stock_item', 'updated', before, after);
    return after;
  });
}

function deleteStockItem(scope, actor, clientId, id) {
  return write(async (tx) => {
    await client(tx, scope, clientId);
    const before = await required(repository.findStockItem(tx, scope, clientId, id));
    if (await repository.stockItemInUse(tx, scope, id)) {
      throw error(
        ERROR_CODES.STOCK_ITEM_IN_USE,
        'The item has stock or is the gift of an active promotion',
      );
    }
    await repository.updateStockItem(tx, scope, clientId, id, { deletedAt: clock.now() });
    await audit(tx, actor, 'stock_item', 'deleted', before);
  });
}

/** Portal accounts of a client, through the organization users service. */
async function clientUsers(scope, clientId, query) {
  await client(prisma, scope, clientId);
  return usersService.list(scope, { ...query, clientId, sort: 'fullName:asc' });
}

export const catalogService = Object.freeze({
  listClients,
  clientDetail,
  createClient,
  updateClient,
  deleteClient,
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  listStockItems,
  createStockItem,
  updateStockItem,
  deleteStockItem,
  clientUsers,
});
