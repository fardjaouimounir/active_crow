import { RULE_TYPES, TRANSITION_ACTIONS, TRANSITIONS } from '@fieldflow/shared';
import { z } from 'zod';
import { operation } from '../../core/http/openapi.js';
import * as input from './ruleSets.validators.js';

const READ = 'campaign.read';
const MANAGE = 'campaign.manage';
const uuid = { type: 'string', format: 'uuid' };
const dateTime = { type: ['string', 'null'], format: 'date-time' };

const summarySchema = {
  type: 'object',
  properties: {
    id: uuid,
    version: { type: 'integer' },
    status: { enum: ['draft', 'approved', 'superseded'] },
    effectiveFrom: dateTime,
    approvedAt: dateTime,
    approvedBy: {
      type: ['object', 'null'],
      properties: { id: uuid, fullName: { type: 'string' } },
    },
    source: { type: 'string' },
  },
};
const promotionSchema = {
  type: 'object',
  properties: {
    id: uuid,
    type: { enum: ['gift_with_purchase', 'tiered_gift'] },
    name: { type: 'string' },
    maxPerCustomer: { type: ['integer', 'null'] },
    productId: { type: ['string', 'null'], format: 'uuid' },
    tiers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: uuid,
          minQuantity: { type: 'integer' },
          stockItemId: uuid,
          giftQuantity: { type: 'integer' },
        },
      },
    },
  },
};
const detailSchema = {
  ...summarySchema,
  description:
    'Not served to client-role users (404); Animateurs may read only the effective version.',
  properties: {
    ...summarySchema.properties,
    rules: {
      type: 'object',
      description: `Rule configs by rule type (${RULE_TYPES.join(', ')}), validated by the shared schemas`,
      additionalProperties: true,
    },
    promotions: { type: 'array', items: promotionSchema },
  },
};
const campaignSchema = { type: 'object', description: 'The campaign detail after the change' };
const readinessSchema = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { enum: TRANSITION_ACTIONS },
          to: { type: 'string' },
          allowed: { type: 'boolean' },
          reasonRequired: { type: 'boolean' },
          blockers: {
            type: 'array',
            items: {
              type: 'object',
              properties: { code: { type: 'string' }, details: { type: 'object' } },
            },
          },
        },
      },
    },
  },
};

const base = '/campaigns/{id}';
const sets = base + '/rule-sets';
const set = sets + '/{rsId}';

const paths = [
  operation('get', sets, 'List the rule set versions', READ, {
    params: input.campaignParams,
    array: true,
    dataSchema: summarySchema,
  }),
  operation(
    'get',
    sets + '/effective',
    'The rule set in force at a moment (default now); 404 if none was approved by then',
    READ,
    { params: input.campaignParams, query: input.effectiveQuery, dataSchema: detailSchema },
  ),
  operation('get', set, 'Read a rule set with its rules and promotions', READ, {
    params: input.ruleSetParams,
    dataSchema: detailSchema,
  }),
  operation('post', sets, 'Create the next draft version as a copy of the approved one', MANAGE, {
    params: input.campaignParams,
    status: 201,
    dataSchema: detailSchema,
  }),
  operation('delete', set, 'Discard a draft rule set (version 2 or later)', MANAGE, {
    params: input.ruleSetParams,
    status: 204,
  }),
  operation(
    'put',
    set + '/rules/{ruleType}',
    'Save the config of one rule type of a draft',
    MANAGE,
    {
      params: input.ruleParams,
      body: z.looseObject({}),
      dataSchema: { type: 'object' },
    },
  ),
  operation(
    'delete',
    set + '/rules/{ruleType}',
    'Remove an optional rule type of a draft',
    MANAGE,
    {
      params: input.ruleParams,
      status: 204,
    },
  ),
  operation('put', set + '/promotions', 'Replace the promotions of a draft', MANAGE, {
    params: input.ruleSetParams,
    body: input.promotions,
    array: true,
    dataSchema: promotionSchema,
  }),
  operation(
    'post',
    set + '/approve',
    'Approve a draft: it takes effect now and supersedes the previous version',
    'campaign.rules.approve',
    { params: input.ruleSetParams, dataSchema: detailSchema },
  ),
  operation('get', base + '/readiness', 'What blocks each available lifecycle action', READ, {
    params: input.campaignParams,
    dataSchema: readinessSchema,
  }),
  ...TRANSITION_ACTIONS.map((action) =>
    operation(
      'post',
      base + '/' + action,
      `Transition ${TRANSITIONS[action].from.join(' | ')} → ${TRANSITIONS[action].to}`,
      'campaign.transition',
      { params: input.campaignParams, body: input.transitionBody, dataSchema: campaignSchema },
    ),
  ),
];

export function registerRuleSetsOpenApi(registry) {
  paths.forEach((path) => registry.register(path));
}
