import { fieldInteraction, saleReason, tombolaInput } from '@fieldflow/shared';
import { operation } from '../../core/http/openapi.js';
import * as input from './sales.validators.js';

export function registerSalesOpenApi(registry) {
  const add = (method, path, title, permission, options = {}) =>
    registry.register(
      operation(method, path, title, permission, {
        ...(path.includes('{id}') ? { params: input.params } : {}),
        ...options,
      }),
    );
  add('post', '/assignments/{id}/sales', 'Record a sale and its gifts and entries', 'sale.record', {
    body: input.saleBody,
    status: 201,
    idempotent: true,
    multipart: { fields: input.saleBody, name: 'proof', required: false },
  });
  add('post', '/assignments/{id}/interactions', 'Record field interactions', 'sale.record', {
    body: fieldInteraction,
    status: 201,
    idempotent: true,
  });
  add('post', '/entitlements/{id}/deliver', 'Deliver an undelivered gift', 'sale.record', {
    idempotent: true,
    body: input.empty,
  });
  add('post', '/sales/{id}/void', 'Void a sale', 'sale.void', { body: saleReason });
  add('post', '/campaigns/{id}/tombolas', 'Configure a Tombola', 'tombola.manage', {
    body: tombolaInput,
    status: 201,
  });
  add('patch', '/tombolas/{id}', 'Edit Tombola configuration', 'tombola.manage', {
    body: input.tombolaPatch,
  });
  add('post', '/tombolas/{id}/close', 'Close registration', 'tombola.manage', {
    body: input.empty,
  });
  add('get', '/campaigns/{id}/sales', 'List campaign sales', 'sale.read', {
    query: input.saleQuery,
    list: true,
  });
  add(
    'get',
    '/campaigns/{id}/sales/review',
    'Review delivered gifts on voided sales',
    'sale.read',
    { array: true },
  );
  add('get', '/campaigns/{id}/entitlements/undelivered', 'List undelivered gifts', 'sale.read', {
    array: true,
  });
  add('get', '/campaigns/{id}/customers', 'List masked customers', 'sale.read');
  add('get', '/customers/{id}', 'Read customer personal data with audit', 'customer.read_personal');
  add('get', '/campaigns/{id}/tombolas', 'List campaign Tombolas', 'tombola.read', { array: true });
  add('get', '/tombolas/{id}/entries', 'List masked Tombola entries', 'tombola.read', {
    query: input.entriesQuery,
    list: true,
  });
  add('get', '/sales/{id}', 'Read a sale and its recorded outcomes', 'sale.read');
  add('get', '/me/sales/today', 'Read today’s sales and interactions', 'sale.record');
}
