import * as schema from '@fieldflow/shared';
import { operation } from '../../core/http/openapi.js';
import * as input from './inventory.validators.js';

const { params, movementParams } = input;
const IDEMPOTENT = ' Requires an Idempotency-Key header (UUID); a retry replays the response.';

export function registerInventoryOpenApi(registry) {
  const add = (...args) => registry.register(operation(...args));
  add(
    'post',
    '/campaigns/{id}/stock/stock-in',
    'Receive stock from the client' + IDEMPOTENT,
    'inventory.stock_in',
    {
      params,
      body: schema.stockInBody,
      multipart: { fields: schema.stockInBody },
      status: 201,
    },
  );
  add(
    'post',
    '/campaigns/{id}/stock/transfers',
    'Send stock down the chain' + IDEMPOTENT,
    'inventory.transfer',
    {
      params,
      body: schema.transferBody,
      status: 201,
    },
  );
  add(
    'post',
    '/stock/transfers/{movementId}/confirm',
    'Confirm receipt of a transfer or return' + IDEMPOTENT,
    'inventory.confirm',
    {
      params: movementParams,
      body: schema.confirmBody,
    },
  );
  add(
    'post',
    '/stock/transfers/{movementId}/cancel',
    'Cancel a pending transfer (sender)' + IDEMPOTENT,
    'inventory.transfer or inventory.return',
    {
      params: movementParams,
      body: schema.emptyBody,
    },
  );
  add(
    'post',
    '/campaigns/{id}/stock/returns',
    'Return stock up the chain or to the client' + IDEMPOTENT,
    'inventory.return',
    {
      params,
      body: schema.returnBody,
      status: 201,
    },
  );
  add(
    'post',
    '/stock/transfers/{movementId}/resolve',
    'Resolve a disputed transfer' + IDEMPOTENT,
    'inventory.adjust.approve',
    {
      params: movementParams,
      body: schema.resolveBody,
    },
  );
  add(
    'post',
    '/campaigns/{id}/stock/adjustments',
    'Request a stock adjustment' + IDEMPOTENT,
    'inventory.adjust.request',
    {
      params,
      body: schema.adjustmentBody,
      multipart: { fields: schema.adjustmentBody },
      status: 201,
    },
  );
  add(
    'post',
    '/stock/adjustments/{movementId}/approve',
    'Approve a stock adjustment' + IDEMPOTENT,
    'inventory.adjust.approve',
    {
      params: movementParams,
      body: schema.adjustmentApprovalBody,
    },
  );
  add(
    'post',
    '/stock/adjustments/{movementId}/reject',
    'Reject a stock adjustment' + IDEMPOTENT,
    'inventory.adjust.approve',
    {
      params: movementParams,
      body: schema.adjustmentRejectionBody,
    },
  );
  add('get', '/campaigns/{id}/stock/balances', 'Balances per location and item', 'inventory.read', {
    params,
  });
  add('get', '/campaigns/{id}/stock/movements', 'Stock movements of a campaign', 'inventory.read', {
    params,
    query: schema.movementFilters,
    list: true,
  });
  add(
    'get',
    '/campaigns/{id}/stock/reconciliation',
    'Stock reconciliation report',
    'inventory.read',
    { params },
  );
  add(
    'get',
    '/campaigns/{id}/stock/recipients',
    'Valid recipients for a transfer or return',
    'inventory.read',
    {
      params,
      query: schema.recipientsQuery,
      array: true,
    },
  );
  add(
    'get',
    '/stock/movements/{movementId}',
    'One stock movement with its ledger entries',
    'inventory.read',
    {
      params: movementParams,
    },
  );
  add('get', '/me/stock', 'My stock, pending confirmations and approvals', 'inventory.read');
}
