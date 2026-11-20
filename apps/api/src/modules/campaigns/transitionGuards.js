// Transition guards (FR-030, BR-10, BR-15). A guard answers "what blocks this action right now?" with
// zero or more blockers. Later modules (tombola, sales…) add their own with
// `registerTransitionGuard(action, guard)` without editing this module.
import { TRANSITION_ACTIONS } from '@fieldflow/shared';
import { assignmentReadService } from '../assignments/assignmentReadService.js';
import { inventoryReadService } from '../inventory/inventoryReadService.js';
import * as ruleSets from './ruleSets.repository.js';

/**
 * @typedef {{ code: string, details?: object }} Blocker
 * @typedef {{ db: object, scope: object, campaign: object, today: string }} GuardContext
 *   `campaign` is the campaign detail (wilayas with staff, points of sale, products, dates);
 *   `today` is the Africa/Algiers business date from the injectable clock.
 * @typedef {(context: GuardContext) => Blocker[] | Promise<Blocker[]>} TransitionGuard
 */

/** @type {Map<string, Set<TransitionGuard>>} */
const registry = new Map();

/**
 * @param {string} action one of the lifecycle actions
 * @param {TransitionGuard} guard
 * @returns {() => void} removes the guard again (used by tests)
 */
export function registerTransitionGuard(action, guard) {
  if (!TRANSITION_ACTIONS.includes(action))
    throw new Error(`Unknown transition action "${action}"`);
  const guards = registry.get(action) ?? new Set();
  guards.add(guard);
  registry.set(action, guards);
  return () => guards.delete(guard);
}

/** Runs every guard of `action` (one after the other: they share one connection). @returns {Promise<Blocker[]>} */
export async function runGuards(action, context) {
  const blockers = [];
  for (const guard of registry.get(action) ?? []) blockers.push(...(await guard(context)));
  return blockers;
}

const blocker = (code, details) => (details ? { code, details } : { code });

const approvedRuleSet = async ({ db, scope, campaign }) =>
  (await ruleSets.hasApproved(db, scope, campaign.id)) ? [] : [blocker('NO_APPROVED_RULE_SET')];

const withinDates =
  ({ beforeStart }) =>
  ({ campaign, today }) => {
    const blockers = [];
    if (beforeStart && today < campaign.startDate) {
      blockers.push(blocker('BEFORE_START_DATE', { startDate: campaign.startDate }));
    }
    if (today > campaign.endDate) {
      blockers.push(blocker('AFTER_END_DATE', { endDate: campaign.endDate }));
    }
    return blockers;
  };

const wilayasWithout = (campaign, role) =>
  campaign.wilayas
    .filter((wilaya) => !wilaya.staff.some((member) => member.role === role))
    .map((wilaya) => wilaya.wilayaId);

registerTransitionGuard('plan', ({ campaign }) => {
  const blockers = [];
  if (!campaign.wilayas.some((wilaya) => wilaya.requiredAnimateurs > 0)) {
    blockers.push(blocker('NO_WILAYA_WITH_NEED'));
  }
  if (campaign.products.length === 0) blockers.push(blocker('NO_PRODUCT'));
  return blockers;
});

registerTransitionGuard('mark-assigned', approvedRuleSet);
registerTransitionGuard('mark-assigned', ({ campaign }) =>
  campaign.pointsOfSale.length === 0 ? [blocker('NO_POINT_OF_SALE')] : [],
);
registerTransitionGuard('mark-assigned', ({ campaign }) => {
  const blockers = [];
  const noSupervisor = wilayasWithout(campaign, 'supervisor');
  if (noSupervisor.length) {
    blockers.push(blocker('WILAYA_WITHOUT_SUPERVISOR', { wilayaIds: noSupervisor }));
  }
  if (campaign.assignmentApproverRole === 'regional_manager') {
    const noRegional = wilayasWithout(campaign, 'regional_manager');
    if (noRegional.length) {
      blockers.push(blocker('WILAYA_WITHOUT_REGIONAL', { wilayaIds: noRegional }));
    }
  }
  return blockers;
});

registerTransitionGuard('activate', approvedRuleSet);
registerTransitionGuard('activate', async ({ db, campaign }) =>
  (await assignmentReadService.countApproved(db, campaign.id)) > 0
    ? []
    : [blocker('NO_APPROVED_ASSIGNMENT')],
);
registerTransitionGuard('activate', withinDates({ beforeStart: true }));

registerTransitionGuard('resume', withinDates({ beforeStart: false }));

registerTransitionGuard('close', ({ db, campaign }) =>
  inventoryReadService.closingBlockers(db, campaign.id),
);

registerTransitionGuard('cancel', async ({ db, campaign }) => {
  const balances = await inventoryReadService.countPhysicalBalances(db, campaign.id);
  return balances > 0 ? [blocker('PHYSICAL_STOCK_REMAINING', { count: balances })] : [];
});
