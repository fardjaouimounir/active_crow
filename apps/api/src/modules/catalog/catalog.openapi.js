import { operation } from '../../core/http/openapi.js';
import * as input from './catalog.validators.js';

const READ = 'catalog.read';
const MANAGE = 'catalog.manage';
const uuid = { type: 'string', format: 'uuid' };
const text = { type: 'string' };
const nullableText = { type: ['string', 'null'] };
const money = {
  type: ['string', 'null'],
  pattern: '^\\d{1,12}\\.\\d{2}$',
  description: 'Decimal string in DZD, never a JSON number',
  examples: ['1250.00'],
};
const timestamps = {
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
};

const clientSchema = {
  type: 'object',
  required: ['id', 'name', 'counts'],
  properties: {
    id: uuid,
    name: text,
    legalName: nullableText,
    contactName: nullableText,
    contactEmail: nullableText,
    contactPhone: nullableText,
    counts: {
      type: 'object',
      properties: {
        products: { type: 'integer' },
        stockItems: { type: 'integer' },
        portalUsers: { type: 'integer' },
      },
    },
    ...timestamps,
  },
};
const itemBase = {
  id: uuid,
  clientId: uuid,
  sku: text,
  name: text,
  unitLabel: text,
  ...timestamps,
};
const productSchema = {
  type: 'object',
  required: ['id', 'clientId', 'sku', 'name', 'unitLabel', 'referencePrice'],
  properties: { ...itemBase, referencePrice: money },
};
const stockItemSchema = {
  type: 'object',
  required: ['id', 'clientId', 'kind', 'sku', 'name', 'unitLabel'],
  properties: { ...itemBase, kind: { enum: ['gift', 'sample'] } },
};

function nested({ path, label, param, schema, list, create, update, params }) {
  const base = '/clients/{id}/' + path;
  const item = base + '/{' + param + '}';
  return [
    operation('get', base, 'List the ' + label + 's of a client', READ, {
      params: input.clientParams,
      query: list,
      list: true,
      dataSchema: schema,
    }),
    operation('post', base, 'Create a ' + label, MANAGE, {
      params: input.clientParams,
      body: create,
      status: 201,
      dataSchema: schema,
    }),
    operation('patch', item, 'Update a ' + label, MANAGE, {
      params,
      body: update,
      dataSchema: schema,
    }),
    operation('delete', item, 'Soft-delete a ' + label + ' that is not in use', MANAGE, {
      params,
      status: 204,
    }),
  ];
}

const paths = [
  operation('get', '/clients', 'List clients with catalog and portal counts', READ, {
    query: input.clientList,
    list: true,
    dataSchema: clientSchema,
  }),
  operation('post', '/clients', 'Create a client', MANAGE, {
    body: input.createClient,
    status: 201,
    dataSchema: clientSchema,
  }),
  operation('get', '/clients/{id}', 'Read a client', READ, {
    params: input.clientParams,
    dataSchema: clientSchema,
  }),
  operation('patch', '/clients/{id}', 'Update a client (last write wins)', MANAGE, {
    params: input.clientParams,
    body: input.updateClient,
    dataSchema: clientSchema,
  }),
  operation(
    'delete',
    '/clients/{id}',
    'Soft-delete a client without unfinished campaigns and suspend its portal accounts',
    MANAGE,
    { params: input.clientParams, status: 204 },
  ),
  operation('get', '/clients/{id}/users', 'List the portal accounts of a client', 'org.user.read', {
    params: input.clientParams,
    query: input.clientUserList,
    list: true,
  }),
  ...nested({
    path: 'products',
    label: 'product',
    param: 'productId',
    schema: productSchema,
    list: input.productList,
    create: input.createProduct,
    update: input.updateProduct,
    params: input.productParams,
  }),
  ...nested({
    path: 'stock-items',
    label: 'gift or sample',
    param: 'itemId',
    schema: stockItemSchema,
    list: input.stockItemList,
    create: input.createStockItem,
    update: input.updateStockItem,
    params: input.stockItemParams,
  }),
];

export function registerCatalogOpenApi(registry) {
  paths.forEach((path) => registry.register(path));
}
