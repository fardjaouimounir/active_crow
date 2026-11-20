// Campaign lifecycle (FR-030, docs/01 §3.1): the allowed transitions, shared by the API (guards)
// and the web app (stepper, buttons).
import { z } from 'zod';

/**
 * action → `{ from, to, reason }`. `reason`: 'always' (required), 'beforeEnd' (required only while
 * today is before the end date) or 'never' (optional).
 */
export const TRANSITIONS = Object.freeze({
  plan: Object.freeze({ from: ['draft'], to: 'planning', reason: 'never' }),
  'mark-assigned': Object.freeze({ from: ['planning'], to: 'assigned', reason: 'never' }),
  activate: Object.freeze({ from: ['assigned'], to: 'active', reason: 'never' }),
  suspend: Object.freeze({ from: ['active'], to: 'suspended', reason: 'always' }),
  resume: Object.freeze({ from: ['suspended'], to: 'active', reason: 'never' }),
  complete: Object.freeze({ from: ['active', 'suspended'], to: 'completed', reason: 'beforeEnd' }),
  close: Object.freeze({ from: ['completed'], to: 'closed', reason: 'never' }),
  cancel: Object.freeze({
    from: ['draft', 'planning', 'assigned', 'active', 'suspended'],
    to: 'cancelled',
    reason: 'always',
  }),
});

export const TRANSITION_ACTIONS = Object.freeze(Object.keys(TRANSITIONS));

/** The main path of the stepper; `suspended` and `cancelled` are shown apart. */
export const LIFECYCLE_STEPS = Object.freeze([
  'draft',
  'planning',
  'assigned',
  'active',
  'completed',
  'closed',
]);

/** Blocker codes of the readiness view (translated in the UI; not HTTP errors). */
export const BLOCKER_CODES = Object.freeze([
  'NO_WILAYA_WITH_NEED',
  'NO_PRODUCT',
  'NO_APPROVED_RULE_SET',
  'NO_POINT_OF_SALE',
  'WILAYA_WITHOUT_SUPERVISOR',
  'WILAYA_WITHOUT_REGIONAL',
  'NO_APPROVED_ASSIGNMENT',
  'BEFORE_START_DATE',
  'AFTER_END_DATE',
  'PHYSICAL_STOCK_REMAINING',
  'OPEN_STOCK_MOVEMENTS',
]);

/** @param {string} status @returns {string[]} the actions available from `status` */
export function actionsFrom(status) {
  return TRANSITION_ACTIONS.filter((action) => TRANSITIONS[action].from.includes(status));
}

/** Whether `action` needs a reason now. @param {string} action @param {boolean} beforeEnd */
export function reasonRequired(action, beforeEnd) {
  const { reason } = TRANSITIONS[action];
  return reason === 'always' || (reason === 'beforeEnd' && beforeEnd);
}

export const transitionBodySchema = z.strictObject({
  reason: z.string().trim().min(3).max(500).optional(),
});
