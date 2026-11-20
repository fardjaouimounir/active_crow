import { can } from '@fieldflow/shared';
import { ScopeService } from '../../core/authz/index.js';
import { registerFileAccessPolicy } from '../files/fileAccessPolicies.js';
import { subscribe } from '../notifications/subscriptions.js';
import { sales, saleVisible } from './sales.repository.js';

registerFileAccessPolicy('sale_proof', async (actor, file, db) => {
  if (!can(actor.role, 'sale.read')) return null;
  const scope = ScopeService.resolve(actor);
  const rows = await sales(db, scope, { proofFileId: file.id });
  for (const row of rows) if (await saleVisible(db, scope, row)) return {};
  return null;
});

subscribe('entitlement.undelivered', async (_tx, { payload }) => ({
  userIds: [payload.supervisorId],
  entityType: 'issue',
  entityId: payload.issueId,
  payload: { saleId: payload.saleId, entitlementId: payload.entitlementId },
}));
