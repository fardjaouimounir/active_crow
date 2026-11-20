// Rule sets (FR-033, FR-034, BR-14): rules and promotions are versioned. A draft is edited freely;
// approval freezes it (it is never edited again) and supersedes the previous version; a change after
// that is a new draft cloned from the approved one. All mutations hold the campaign row lock, which
// also serializes concurrent approvals and draft creation.
import { ERROR_CODES, REQUIRED_RULE_TYPES, validateRuleConfig } from '@fieldflow/shared';
import { auditService } from '../../core/audit/index.js';
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../core/errors/index.js';
import { clock } from '../../core/time/clock.js';
import { prisma } from '../../db/client.js';
import { withTransaction } from '../../db/transaction.js';
import * as campaigns from './campaigns.repository.js';
import { assertEditable } from './editPolicy.js';
import * as repository from './ruleSets.repository.js';
import {
  problemToError,
  promotionProblems,
  promotionsToPayload,
  ruleIssues,
  ruleReferenceIssues,
} from './ruleSetValidation.js';

const rule = (code, message, details) => new AppError({ status: 422, code, message, details });

async function required(record) {
  const row = await record;
  if (!row) throw new NotFoundError();
  return row;
}

/**
 * Who may read rule sets: staff in scope. Client users never (404); Animateurs only the effective
 * version (the field app needs it), not drafts or history.
 */
async function readableCampaign(db, scope, campaignId, { effectiveOnly = false } = {}) {
  if (scope.level === 'client' || (scope.level === 'self' && !effectiveOnly)) {
    throw new NotFoundError();
  }
  return required(campaigns.findCampaign(db, scope, campaignId));
}

/** Row-locks the campaign and checks that its rule sets are editable in its status. */
async function lockEditable(tx, scope, campaignId) {
  const campaign = await required(campaigns.lockCampaign(tx, scope, campaignId));
  assertEditable(campaign, 'ruleSet');
  return campaign;
}

async function draftOf(tx, scope, campaignId, ruleSetId) {
  const ruleSet = await required(repository.findRuleSet(tx, scope, campaignId, ruleSetId));
  if (ruleSet.status !== 'draft') {
    throw rule(ERROR_CODES.RULE_SET_NOT_DRAFT, 'An approved rule set is never edited', {
      status: ruleSet.status,
    });
  }
  return ruleSet;
}

function audit(tx, actor, action, ruleSetId, before, after) {
  return auditService.record(tx, {
    actor,
    action: 'campaign.' + action,
    entityType: 'rule_set',
    entityId: ruleSetId,
    before,
    after,
  });
}

async function write(work) {
  try {
    return await withTransaction(work);
  } catch (err) {
    if (err instanceof ConflictError && err.details?.constraint === 'rule_sets_one_draft') {
      throw rule(ERROR_CODES.DRAFT_ALREADY_EXISTS, 'The campaign already has a draft rule set');
    }
    throw err;
  }
}

async function list(scope, campaignId) {
  await readableCampaign(prisma, scope, campaignId);
  return repository.listRuleSets(prisma, scope, campaignId);
}

async function detail(scope, campaignId, ruleSetId) {
  await readableCampaign(prisma, scope, campaignId);
  return required(repository.findRuleSet(prisma, scope, campaignId, ruleSetId));
}

/** The version in force at `at` (default now); 404 when none was approved by then. */
async function effective(scope, campaignId, at = clock.now(), db = prisma) {
  await readableCampaign(db, scope, campaignId, { effectiveOnly: true });
  return required(repository.findEffective(db, scope, campaignId, at));
}

/** Saves one rule config of a draft: shape (400 with the field path) then references (422). */
function saveRule(scope, actor, campaignId, ruleSetId, ruleType, config) {
  const shape = validateRuleConfig(ruleType, config);
  if (!shape.success) {
    throw new ValidationError(
      shape.issues.map(({ path, message }) => ({ path: path ? 'body.' + path : 'body', message })),
    );
  }
  return write(async (tx) => {
    const campaign = await lockEditable(tx, scope, campaignId);
    await draftOf(tx, scope, campaignId, ruleSetId);
    const issues = await ruleReferenceIssues(
      tx,
      scope,
      { id: campaignId, clientId: campaign.clientId },
      ruleType,
      shape.data,
    );
    if (issues.length) {
      throw rule(
        ERROR_CODES.INVALID_RULE_CONFIG,
        'The rule refers to something that is not allowed',
        {
          ruleType,
          path: 'body.' + issues[0].path,
          issues,
        },
      );
    }
    await repository.upsertRule(tx, scope, ruleSetId, ruleType, shape.data);
    await audit(tx, actor, 'rule_saved', ruleSetId, undefined, { campaignId, ruleType });
    return shape.data;
  });
}

function removeRule(scope, actor, campaignId, ruleSetId, ruleType) {
  return write(async (tx) => {
    await lockEditable(tx, scope, campaignId);
    await draftOf(tx, scope, campaignId, ruleSetId);
    if (REQUIRED_RULE_TYPES.includes(ruleType)) {
      throw new BusinessRuleError('This rule type is required and cannot be removed', {
        reason: 'REQUIRED_RULE_TYPE',
        ruleType,
      });
    }
    if ((await repository.deleteRule(tx, ruleSetId, ruleType)) === 0) throw new NotFoundError();
    await audit(tx, actor, 'rule_removed', ruleSetId, { campaignId, ruleType });
  });
}

function savePromotions(scope, actor, campaignId, ruleSetId, { promotions }) {
  return write(async (tx) => {
    const campaign = await lockEditable(tx, scope, campaignId);
    const before = await draftOf(tx, scope, campaignId, ruleSetId);
    const [problem] = await promotionProblems(
      tx,
      scope,
      { id: campaignId, clientId: campaign.clientId },
      promotions,
    );
    if (problem) throw problemToError(problem);
    await repository.replacePromotions(tx, scope, ruleSetId, promotions);
    await audit(
      tx,
      actor,
      'promotions_saved',
      ruleSetId,
      { promotions: before.promotions.length },
      { campaignId, promotions: promotions.length },
    );
    return (await repository.findRuleSet(tx, scope, campaignId, ruleSetId)).promotions;
  });
}

/**
 * Approval (BR-10, BR-14): everything stored is validated again — a product or gift may have been
 * deleted since the draft was saved. Takes effect now; the previous approved version is superseded.
 */
function approve(scope, actor, campaignId, ruleSetId) {
  return write(async (tx) => {
    const campaign = await lockEditable(tx, scope, campaignId);
    const draft = await draftOf(tx, scope, campaignId, ruleSetId);
    const missing = REQUIRED_RULE_TYPES.filter((type) => !Object.hasOwn(draft.rules, type));
    if (missing.length) {
      throw rule(ERROR_CODES.RULE_SET_INCOMPLETE, 'Required rules are missing', { missing });
    }
    const context = { id: campaignId, clientId: campaign.clientId };
    const issues = [];
    for (const [ruleType, config] of Object.entries(draft.rules)) {
      for (const issue of await ruleIssues(tx, scope, context, ruleType, config)) {
        issues.push({ scope: 'rule', ruleType, ...issue });
      }
    }
    const problems = await promotionProblems(
      tx,
      scope,
      context,
      promotionsToPayload(draft.promotions),
      'promotions',
    );
    for (const problem of problems) issues.push({ scope: 'promotion', ...problem });
    if (issues.length) {
      throw rule(ERROR_CODES.INVALID_RULE_CONFIG, 'The rule set is no longer valid', { issues });
    }

    const previous = await repository.currentApproved(tx, scope, campaignId);
    if (previous) await repository.supersede(tx, scope, previous.id);
    const at = clock.now();
    await repository.approve(tx, scope, ruleSetId, { approvedById: actor.id, at });
    await audit(tx, actor, 'rule_set_approved', ruleSetId, undefined, {
      campaignId,
      version: draft.version,
      supersedes: previous?.version ?? null,
      ruleTypes: Object.keys(draft.rules).sort(),
      promotions: draft.promotions.map(({ name, type, tiers }) => ({
        name,
        type,
        tiers: tiers.length,
      })),
    });
    return repository.findRuleSet(tx, scope, campaignId, ruleSetId);
  });
}

/** New draft = copy of the approved version (rules, promotions and tiers), version n+1. */
function createVersion(scope, actor, campaignId) {
  return write(async (tx) => {
    await lockEditable(tx, scope, campaignId);
    if (await repository.findDraft(tx, scope, campaignId)) {
      throw new AppError({
        status: 409,
        code: ERROR_CODES.DRAFT_ALREADY_EXISTS,
        message: 'The campaign already has a draft rule set',
      });
    }
    const approved = await required(repository.currentApproved(tx, scope, campaignId));
    const source = await repository.findRuleSet(tx, scope, campaignId, approved.id);
    const version = await repository.nextVersion(tx, scope, campaignId);
    const { id } = await repository.createDraft(tx, scope, campaignId, version);
    await repository.copyContent(tx, scope, source, id);
    await audit(tx, actor, 'rule_set_created', id, undefined, {
      campaignId,
      version,
      clonedFrom: source.version,
    });
    return repository.findRuleSet(tx, scope, campaignId, id);
  });
}

/** Discards a draft; the first version stays (it is the campaign's only rule set until approved). */
function discard(scope, actor, campaignId, ruleSetId) {
  return write(async (tx) => {
    await lockEditable(tx, scope, campaignId);
    const draft = await draftOf(tx, scope, campaignId, ruleSetId);
    if (draft.version === 1) {
      throw new BusinessRuleError('The first rule set cannot be discarded', {
        reason: 'FIRST_VERSION',
      });
    }
    await repository.deleteRuleSet(tx, scope, ruleSetId);
    await audit(tx, actor, 'rule_set_discarded', ruleSetId, { campaignId, version: draft.version });
  });
}

export const ruleSetsService = Object.freeze({
  list,
  detail,
  effective,
  saveRule,
  removeRule,
  savePromotions,
  approve,
  createVersion,
  discard,
});
