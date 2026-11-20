import { ScopeService } from '../../core/authz/index.js';
import { registerFileAccessPolicy } from '../files/fileAccessPolicies.js';
import { subscribe } from '../notifications/subscriptions.js';
import { eligibleApprovers, holderUserIdsInScope } from './inventory.policies.js';
import { movementAccess } from './inventory.repository.js';

const entity = (movementId, campaignId, extra = {}) => ({
  entityType: 'stock_movement',
  entityId: movementId,
  payload: { campaignId, movementId, ...extra },
});

const load = (tx, { agencyId, movementId }) =>
  tx.stockMovement.findFirst({
    where: { agencyId, id: movementId },
    include: {
      fromLocation: { select: { userId: true } },
      toLocation: { select: { userId: true, kind: true } },
      campaign: { select: { id: true, agencyId: true } },
    },
  });

subscribe('stock.transfer_created', async (tx, { payload }) => {
  const movement = await load(tx, payload);
  if (!movement) return;
  const recipients = movement.toLocation.userId
    ? [movement.toLocation.userId]
    : (
        await tx.user.findMany({
          where: {
            agencyId: payload.agencyId,
            status: 'active',
            role: { in: ['director', 'general_manager'] },
          },
          select: { id: true },
        })
      ).map(({ id }) => id);
  return { userIds: recipients, ...entity(movement.id, movement.campaignId) };
});

subscribe('stock.transfer_disputed', async (tx, { payload }) => {
  const movement = await load(tx, payload);
  if (!movement) return;
  const parties = [movement.fromLocation.userId, movement.toLocation.userId];
  const approvers = await eligibleApprovers(tx, movement.campaign, parties, [
    movement.createdById,
    movement.confirmedById,
  ]);
  return {
    userIds: [movement.createdById, ...approvers],
    ...entity(movement.id, movement.campaignId),
  };
});

subscribe('stock.adjustment_requested', async (tx, { payload }) => {
  const movement = await load(tx, payload);
  if (!movement) return;
  const approvers = await eligibleApprovers(
    tx,
    movement.campaign,
    [movement.fromLocation.userId],
    [movement.createdById],
  );
  return { userIds: approvers, ...entity(movement.id, movement.campaignId) };
});

subscribe('stock.adjustment_decided', async (tx, { payload }) => {
  const movement = await load(tx, payload);
  if (!movement) return;
  return {
    userIds: [movement.createdById, movement.fromLocation.userId],
    ...entity(movement.id, movement.campaignId, { decision: payload.decision }),
  };
});

/** Proof files are readable by whoever can read the movement they belong to (never client users). */
async function proofPolicy(actor, file, db) {
  if (actor.role === 'client') return null;
  const scope = ScopeService.resolve(actor);
  const movements = await db.stockMovement.findMany({
    where: { agencyId: file.agencyId, proofFileId: file.id },
    select: { id: true, campaignId: true },
  });
  for (const { id, campaignId } of movements) {
    const holderIds = await holderUserIdsInScope(db, actor, campaignId);
    const visible = await db.stockMovement.findFirst({
      where: { AND: [{ id }, movementAccess(scope, holderIds, actor.role)] },
      select: { id: true },
    });
    if (visible) return {};
  }
  return null;
}
registerFileAccessPolicy('stock_document', proofPolicy);
registerFileAccessPolicy('stock_adjustment_proof', proofPolicy);
