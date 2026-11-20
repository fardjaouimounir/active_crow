import { TRANSITION_ACTIONS } from '@fieldflow/shared';
import { authenticate } from '../../core/auth/index.js';
import { requirePermission } from '../../core/authz/index.js';
import { validate } from '../../core/http/index.js';
import * as controller from './ruleSets.controller.js';
import * as input from './ruleSets.validators.js';

/**
 * Rule sets, promotions, readiness and lifecycle transitions of a campaign. `router` is the
 * campaigns router (mounted at `/campaigns`).
 * @param {import('express').Router} router
 */
export function addRuleSetRoutes(router) {
  const read = requirePermission('campaign.read');
  const manage = requirePermission('campaign.manage');
  const query = input.empty;
  const params = input.campaignParams;

  router.get('/:id/rule-sets', authenticate, read, validate({ params, query }), controller.list);
  router.get(
    '/:id/rule-sets/effective',
    authenticate,
    read,
    validate({ params, query: input.effectiveQuery }),
    controller.effective,
  );
  router.get(
    '/:id/rule-sets/:rsId',
    authenticate,
    read,
    validate({ params: input.ruleSetParams, query }),
    controller.detail,
  );
  router.post(
    '/:id/rule-sets',
    authenticate,
    manage,
    validate({ params, query, body: input.empty }),
    controller.createVersion,
  );
  router.delete(
    '/:id/rule-sets/:rsId',
    authenticate,
    manage,
    validate({ params: input.ruleSetParams, query, body: input.empty }),
    controller.discard,
  );
  router.put(
    '/:id/rule-sets/:rsId/rules/:ruleType',
    authenticate,
    manage,
    validate({ params: input.ruleParams, query }),
    controller.saveRule,
  );
  router.delete(
    '/:id/rule-sets/:rsId/rules/:ruleType',
    authenticate,
    manage,
    validate({ params: input.ruleParams, query, body: input.empty }),
    controller.removeRule,
  );
  router.put(
    '/:id/rule-sets/:rsId/promotions',
    authenticate,
    manage,
    validate({ params: input.ruleSetParams, query, body: input.promotions }),
    controller.savePromotions,
  );
  router.post(
    '/:id/rule-sets/:rsId/approve',
    authenticate,
    requirePermission('campaign.rules.approve'),
    validate({ params: input.ruleSetParams, query, body: input.empty }),
    controller.approve,
  );

  router.get(
    '/:id/readiness',
    authenticate,
    read,
    validate({ params, query }),
    controller.readiness,
  );
  for (const action of TRANSITION_ACTIONS) {
    router.post(
      '/:id/' + action,
      authenticate,
      requirePermission('campaign.transition'),
      validate({ params, query, body: input.transitionBody }),
      controller.transition(action),
    );
  }
}
