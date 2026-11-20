import { events } from '../../core/events/index.js';
// Campaign lifecycle (FR-030): guarded transitions and the readiness view. A transition locks the
// campaign row, re-runs the guards inside the transaction and records history and audit, so two
// concurrent transitions cannot both succeed.
import { actionsFrom, ERROR_CODES, reasonRequired, TRANSITIONS } from '@fieldflow/shared';
import { auditService } from '../../core/audit/index.js';
import { AppError, NotFoundError } from '../../core/errors/index.js';
import { businessDate } from '../../core/time/clock.js';
import { prisma } from '../../db/client.js';
import { withTransaction } from '../../db/transaction.js';
import * as repository from './campaigns.repository.js';
import { runGuards } from './transitionGuards.js';

const rule = (code, message, details) => new AppError({ status: 422, code, message, details });

async function required(record) {
  const row = await record;
  if (!row) throw new NotFoundError();
  return row;
}

/** Readiness shows internal blockers: staff only, never client users or Animateurs. */
function staffOnly(scope) {
  if (scope.level === 'client' || scope.level === 'self') throw new NotFoundError();
}

/** For every action available from the current status: allowed, and what blocks it. */
async function readiness(scope, campaignId) {
  staffOnly(scope);
  const campaign = await required(repository.findCampaign(prisma, scope, campaignId));
  const today = businessDate();
  const actions = [];
  for (const action of actionsFrom(campaign.status)) {
    const blockers = await runGuards(action, { db: prisma, scope, campaign, today });
    actions.push({
      action,
      to: TRANSITIONS[action].to,
      allowed: blockers.length === 0,
      reasonRequired: reasonRequired(action, today < campaign.endDate),
      blockers,
    });
  }
  return { status: campaign.status, actions };
}

function transition(scope, actor, campaignId, action, { reason } = {}) {
  return withTransaction(async (tx) => {
    const locked = await required(repository.lockCampaign(tx, scope, campaignId));
    const { from, to } = TRANSITIONS[action];
    if (!from.includes(locked.status)) {
      throw rule(
        ERROR_CODES.INVALID_TRANSITION,
        `Cannot ${action} a campaign that is ${locked.status}`,
        {
          status: locked.status,
          action,
        },
      );
    }
    const campaign = await required(repository.findCampaign(tx, scope, campaignId));
    const today = businessDate();
    if (reasonRequired(action, today < campaign.endDate) && !reason) {
      throw rule(ERROR_CODES.REASON_REQUIRED, 'A reason is required for this action', { action });
    }
    const blockers = await runGuards(action, { db: tx, scope, campaign, today });
    if (blockers.length) {
      const hasStock = blockers.some((item) => item.code === 'PHYSICAL_STOCK_REMAINING');
      throw rule(
        action === 'cancel' && hasStock
          ? ERROR_CODES.CAMPAIGN_HAS_STOCK
          : ERROR_CODES.TRANSITION_BLOCKED,
        action === 'cancel' && hasStock
          ? 'Return the stock before cancelling the campaign'
          : 'The campaign is not ready for this action',
        { action, blockers },
      );
    }
    await repository.setStatus(tx, scope, campaignId, to);
    await repository.insertHistory(tx, scope, {
      campaignId,
      fromStatus: locked.status,
      toStatus: to,
      reason: reason ?? null,
      changedById: actor.id,
    });
    await auditService.record(tx, {
      actor,
      action: 'campaign.status_changed',
      entityType: 'campaign',
      entityId: campaignId,
      before: { status: locked.status },
      after: { status: to, transition: action, reason: reason ?? null },
    });
    events.emit(tx, 'campaign.status_changed', {
      agencyId: actor.agencyId,
      actorId: actor.id,
      campaignId,
      status: to,
    });
    return repository.findCampaign(tx, scope, campaignId);
  });
}

export const lifecycleService = Object.freeze({ readiness, transition });
