// AI integration (suggestion-only). Trigger → pg-boss job → aggregate payload → AI service (202) →
// callback → ai_suggestions row `pending_review` → human review → accepted text shown next to the
// dashboards. The AI service never writes business data and our KPIs stay the numbers on screen.
import { createHash, randomUUID } from 'node:crypto';
import { AI_SUBJECT_TYPES, ERROR_CODES } from '@fieldflow/shared';
import { logger as rootLogger } from '../../config/logger.js';
import { auditService } from '../../core/audit/index.js';
import { buildUserActor } from '../../core/auth/actor.js';
import { ScopeService } from '../../core/authz/index.js';
import { campaignWhere, scoped } from '../../core/authz/scopeFilters.js';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../core/errors/index.js';
import { events } from '../../core/events/index.js';
import { jobs } from '../../core/jobs/index.js';
import { businessDate, clock } from '../../core/time/clock.js';
import { prisma } from '../../db/client.js';
import { withTransaction } from '../../db/transaction.js';
import { reportingService } from '../reporting/reporting.service.js';
import { aiConfig } from './ai.config.js';
import * as repository from './ai.repository.js';
import { sendToAiService } from './aiClient.js';
import {
  AiPayloadError,
  assemblePayload,
  hasSalesTarget,
  payloadBuilders,
  validatePayload,
} from './aiPayloads.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const SCHEDULED_LOCALE = 'ar';
const shift = (date, days) => new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
const queueOf = (capability) => `ai.${capability}`;
const sha256 = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => [key, canonical(child)]),
        )
      : value;

/** Filters stored with a request → filters of the reporting service (no workDate, no locale). */
function reportFilters({ campaignIds, supervisorIds, from, to }) {
  return { ...(campaignIds && { campaignIds }), ...(supervisorIds && { supervisorIds }), from, to };
}

function ensureEnabled() {
  if (!aiConfig.enabled())
    throw new AppError({
      status: 503,
      code: ERROR_CODES.AI_DISABLED,
      message: 'The AI service is not configured',
    });
}

// ─── Trigger ─────────────────────────────────────────────────────────────────

function assertMayRequest(actor, { capability, subjectId }) {
  if (
    actor.role === 'supervisor' &&
    (capability !== 'supervisor_daily_summary' || subjectId !== actor.id)
  )
    throw new AppError({
      status: 403,
      code: ERROR_CODES.AI_SUBJECT_NOT_ALLOWED,
      message: 'A supervisor can only request their own daily summary',
    });
}

/** The reporting filters (and stored filters) of a request, validated against the actor's scope. */
async function resolveFilters(actor, { capability, subjectId, locale, filters }) {
  const today = businessDate(clock.now());
  if (AI_SUBJECT_TYPES[capability] === 'supervisor') {
    const workDate = filters.workDate ?? today;
    if (workDate > today)
      throw new ValidationError([
        { path: 'body.filters.workDate', message: 'Must not be in the future' },
      ]);
    return { supervisorIds: [subjectId], from: workDate, to: workDate, workDate, locale };
  }
  const scope = ScopeService.resolve(actor);
  const campaign = await prisma.campaign.findFirst({
    where: scoped(campaignWhere(scope), { id: subjectId }),
    select: { startDate: true, endDate: true },
  });
  if (!campaign) throw new NotFoundError();
  const start = campaign.startDate.toISOString().slice(0, 10);
  const end = campaign.endDate.toISOString().slice(0, 10);
  const from = filters.from ?? start;
  const to = filters.to ?? (today < from ? from : today < end ? today : end);
  if (from > to)
    throw new ValidationError([{ path: 'body.filters.to', message: 'Invalid period' }]);
  return { campaignIds: [subjectId], from, to, locale };
}

function dispatch(aiRequest) {
  if (jobs.isRunning())
    return jobs.enqueue(queueOf(aiRequest.capability), { aiRequestId: aiRequest.id });
  // No job queue (tests, a dev run without JOBS_ENABLED): run in the background like an event.
  setImmediate(() => {
    processRequest({ aiRequestId: aiRequest.id }).catch((err) =>
      rootLogger.error({ err, aiRequestId: aiRequest.id }, 'AI request failed'),
    );
  });
  return null;
}

/**
 * Creates a request, or returns the one already queued or sent for the same capability, subject
 * and filters within the last hour (cost guard).
 */
async function createOrReuse({ agencyId, capability, subjectId, filters, requestedById }) {
  const stored = canonical(filters);
  const key = `${agencyId}:${requestedById}:${capability}:${subjectId}:${sha256(stored)}`;
  const result = await withTransaction(async (tx) => {
    await tx.$queryRaw`SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const existing = await repository.findRecentRequest(tx, {
      agencyId,
      capability,
      subjectId,
      filters: stored,
      requestedById,
      since: new Date(clock.now().getTime() - HOUR),
    });
    if (existing) return { request: existing, created: false };
    const request = await repository.createRequest(tx, {
      requestId: randomUUID(),
      agencyId,
      capability,
      subjectType: AI_SUBJECT_TYPES[capability],
      subjectId,
      filters: stored,
      requestedById,
    });
    return { request, created: true };
  });
  if (result.created) {
    try {
      await dispatch(result.request);
    } catch (err) {
      rootLogger.error({ err, aiRequestId: result.request.id }, 'AI job could not be queued');
      await fail(result.request.id, 'The job could not be queued');
    }
  }
  return result;
}

/**
 * FR-110…FR-113: queue an AI suggestion for a supervisor's day or a campaign period.
 * @returns {Promise<{ request: object, created: boolean }>}
 */
async function requestSuggestion(actor, input) {
  ensureEnabled();
  assertMayRequest(actor, input);
  const filters = await resolveFilters(actor, input);
  // Reading the KPIs under the requester's scope proves the subject is in scope (404 otherwise)
  // and tells whether the period has a sales target.
  const total = await reportingService.aggregates(actor, reportFilters(filters));
  if (
    (input.capability === 'sales_performance' || input.capability === 'campaign_insights') &&
    !hasSalesTarget(total)
  )
    throw new AppError({
      status: 422,
      code: ERROR_CODES.AI_TARGET_REQUIRED,
      message: 'Set a sales target in the campaign rules before requesting this analysis',
    });
  const { request, created } = await createOrReuse({
    agencyId: actor.agencyId,
    capability: input.capability,
    subjectId: input.subjectId,
    filters,
    requestedById: actor.id,
  });
  return { created, request: requestView(request, new Map()) };
}

/** Every day at 19:30 Algiers: one daily summary per supervisor who had something expected. */
async function scheduleDailySummaries({ agencyId: only } = {}) {
  if (!aiConfig.enabled()) return { created: 0 };
  const today = businessDate(clock.now());
  let created = 0;
  for (const { supervisorId, agencyId } of await repository.supervisorsWorkingOn(prisma, today)) {
    if (only && agencyId !== only) continue;
    const user = await prisma.user.findFirst({
      where: { id: supervisorId, agencyId, status: 'active' },
    });
    if (!user) continue;
    const filters = { supervisorIds: [supervisorId], from: today, to: today };
    const total = await reportingService.aggregates(buildUserActor(user), filters);
    if (!total.attendance.expectedSlots) continue;
    const result = await createOrReuse({
      agencyId,
      capability: 'supervisor_daily_summary',
      subjectId: supervisorId,
      filters: { ...filters, workDate: today, locale: SCHEDULED_LOCALE },
      requestedById: null,
    });
    if (result.created) created += 1;
  }
  return { created };
}

// ─── Outbound job ────────────────────────────────────────────────────────────

async function collectData(capability, actor, request, existing) {
  const filters = reportFilters(request.filters);
  const aggregates = (dimension, override = filters) =>
    reportingService.aggregates(actor, override, dimension);
  switch (capability) {
    case 'supervisor_daily_summary': {
      const lastWeek = shift(filters.from, -7);
      const [today, previous] = await Promise.all([
        aggregates(),
        aggregates(undefined, { ...filters, from: lastWeek, to: lastWeek }),
      ]);
      return payloadBuilders[capability]({ today, previous });
    }
    case 'sales_performance': {
      const [total, animateurs, daily] = await Promise.all([
        aggregates(),
        aggregates('animateur'),
        aggregates('day'),
      ]);
      return payloadBuilders[capability]({ total, animateurs, daily, existing });
    }
    case 'campaign_insights':
      return payloadBuilders[capability]({ total: await aggregates() });
    case 'animateur_coaching':
      return payloadBuilders[capability]({ animateurs: await aggregates('animateur'), existing });
    default:
      throw new AiPayloadError('AI_PAYLOAD_INVALID', 'Unknown capability');
  }
}

async function jobActor(request) {
  const userId =
    request.requestedById ?? (request.subjectType === 'supervisor' ? request.subjectId : null);
  const user =
    userId &&
    (await prisma.user.findFirst({
      where: { id: userId, agencyId: request.agencyId, status: 'active' },
    }));
  return user ? buildUserActor(user) : null;
}

const fail = (id, lastError) =>
  prisma.aiRequest.updateMany({
    where: { id, status: 'queued' },
    data: { status: 'send_failed', lastError: lastError.slice(0, 500) },
  });

/**
 * The pg-boss worker of every `ai.<capability>` queue. Permanent problems end in `send_failed`;
 * transient ones throw so the queue retries (the request id never changes).
 * @param {{ aiRequestId: string }} data
 */
export async function processRequest(
  { aiRequestId },
  { retryCount = 0, retryLimit = 0, logger = rootLogger } = {},
) {
  if (!aiConfig.enabled()) return;
  const request = await repository.findRequest(prisma, aiRequestId);
  if (!request || request.status !== 'queued') return;
  const log = logger.child({ aiRequestId, capability: request.capability });

  const actor = await jobActor(request);
  if (!actor) return void (await fail(request.id, 'The requester is no longer active'));

  let body;
  let labelMap;
  try {
    const { data, labelMap: labels } = await collectData(
      request.capability,
      actor,
      request,
      request.labelMap ?? {},
    );
    const { filters } = request;
    body = validatePayload(
      request.capability,
      assemblePayload({
        capability: request.capability,
        requestId: request.requestId,
        agencyId: request.agencyId,
        subjectId: request.subjectId,
        locale: filters.locale ?? 'en',
        context: {
          ...(filters.workDate && { workDate: filters.workDate }),
          from: filters.from,
          to: filters.to,
        },
        data,
      }),
    );
    labelMap = labels;
  } catch (err) {
    if (err instanceof AiPayloadError) {
      // A guard hit means a builder leaked something: a bug, never retried, always loud.
      log.error({ code: err.code, reason: err.message }, 'AI payload not sent');
      await fail(request.id, `${err.code}: ${err.message}`);
      return;
    }
    if (err instanceof NotFoundError || err instanceof ForbiddenError) {
      await fail(request.id, 'The subject is no longer in the requester scope');
      return;
    }
    if (retryCount >= retryLimit)
      await fail(request.id, 'Unexpected error while building the payload');
    throw err;
  }

  await prisma.aiRequest.update({
    where: { id: request.id },
    data: {
      labelMap,
      payloadHash: sha256(body.input.context.data),
      attempts: { increment: 1 },
    },
  });
  try {
    const { status } = await sendToAiService(request.capability, body);
    const now = clock.now();
    await prisma.aiRequest.updateMany({
      where: { id: request.id, status: 'queued' },
      data: { status: 'sent', sentAt: now, lastError: null },
    });
    // The callback may have completed the request before this update (fast AI service).
    await prisma.aiRequest.updateMany({
      where: { id: request.id, sentAt: null },
      data: { sentAt: now },
    });
    log.info({ aiStatus: status }, 'AI request accepted');
  } catch (err) {
    if (err?.name !== 'AiClientError') throw err;
    log.warn({ permanent: err.permanent, status: err.status }, 'AI request failed');
    if (err.permanent || retryCount >= retryLimit) {
      await fail(request.id, err.message);
      if (err.permanent) return;
    } else {
      await prisma.aiRequest.update({
        where: { id: request.id },
        data: { lastError: err.message },
      });
    }
    throw err;
  }
}

// ─── Inbound callback ────────────────────────────────────────────────────────

/**
 * `POST /internal/ai/results`: stores the result as `pending_review`. Unknown request ids and
 * capability mismatches are permanent 422s, so nobody holding the key can inject a suggestion we
 * never asked for. A duplicate callback inserts nothing and still answers 200.
 * @returns {Promise<{ status: 'stored' | 'duplicate' }>}
 */
async function receiveResult(body) {
  ensureEnabled();
  const request = await repository.findRequestByRequestId(prisma, body.requestId);
  if (!request)
    throw new AppError({
      status: 422,
      code: ERROR_CODES.AI_REQUEST_NOT_FOUND,
      message: 'Unknown requestId',
    });
  if (request.capability !== body.capability)
    throw new AppError({
      status: 422,
      code: ERROR_CODES.AI_CAPABILITY_MISMATCH,
      message: 'The capability does not match the request',
    });

  const outcome = await withTransaction(async (tx) => {
    const id = await repository.insertSuggestion(tx, request, {
      modelVersion: body.modelVersion,
      confidence: Math.round(body.confidence * 1000) / 1000,
      output: JSON.parse(JSON.stringify(body.output).replaceAll('\\u0000', '')),
    });
    if (!id) return { status: 'duplicate' };
    await tx.aiRequest.update({
      where: { id: request.id },
      data: { status: 'completed', completedAt: clock.now() },
    });
    await auditService.record(tx, {
      actor: { type: 'ai_service', id: null },
      agencyId: request.agencyId,
      action: 'ai.suggestion_received',
      entityType: 'ai_suggestion',
      entityId: id,
      after: {
        capability: request.capability,
        modelVersion: body.modelVersion,
        confidence: body.confidence,
      },
    });
    events.emit(tx, 'ai.suggestion_received', {
      agencyId: request.agencyId,
      actorId: null,
      suggestionId: id,
      capability: request.capability,
      requesterId: request.requestedById,
    });
    return { status: 'stored', id };
  });

  const errorCode = body.output.error?.code;
  const log = rootLogger.child({
    aiRequestId: request.id,
    capability: request.capability,
    modelVersion: body.modelVersion,
    confidence: body.confidence,
  });
  if (errorCode === 'PII_FIREWALL')
    log.error('The AI service reported PII in a payload: a builder leaked something');
  else log.info({ aiStatus: outcome.status, errorCode }, 'AI result received');
  return { status: outcome.status };
}

// ─── Review and reading ──────────────────────────────────────────────────────

const pageMeta = (query, total) => ({ page: query.page, pageSize: query.pageSize, total });
const number = (value) => (value == null ? null : Number(value));
const failureOf = (output) =>
  output && typeof output === 'object' ? (output.error?.code ?? null) : null;

async function names(agencyId, rows) {
  const users = new Set();
  const campaigns = new Set();
  for (const row of rows) {
    (row.subjectType === 'supervisor' ? users : campaigns).add(row.subjectId);
  }
  const [userRows, campaignRows] = await Promise.all([
    users.size ? repository.usersByIds(prisma, agencyId, [...users]) : [],
    campaigns.size ? repository.campaignsByIds(prisma, agencyId, [...campaigns]) : [],
  ]);
  return new Map([
    ...userRows.map(({ id, fullName }) => [id, fullName]),
    ...campaignRows.map(({ id, name }) => [id, name]),
  ]);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Label → `{ type: 'user', id, name }` | `{ type: 'period', value }`, names resolved on our side only. */
async function resolveLabels(agencyId, labelMap) {
  const entries = Object.entries(labelMap ?? {});
  const userIds = entries.map(([, id]) => id).filter((id) => UUID.test(id));
  const users = userIds.length ? await repository.usersByIds(prisma, agencyId, userIds) : [];
  const byId = new Map(users.map(({ id, fullName }) => [id, fullName]));
  return Object.fromEntries(
    entries.map(([label, value]) => [
      label,
      UUID.test(value)
        ? { type: 'user', id: value, name: byId.get(value) ?? null }
        : { type: 'period', value },
    ]),
  );
}

function requestView(row, subjects) {
  const suggestion = row.suggestion;
  return {
    id: row.id,
    requestId: row.requestId,
    capability: row.capability,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    subjectName: subjects.get(row.subjectId) ?? null,
    filters: row.filters,
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    requestedById: row.requestedById,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
    completedAt: row.completedAt,
    suggestion: suggestion
      ? { id: suggestion.id, status: suggestion.status, failure: failureOf(suggestion.output) }
      : null,
  };
}

const dateRange = (from, to) =>
  from || to
    ? {
        createdAt: {
          ...(from && { gte: new Date(`${from}T00:00:00+01:00`) }),
          ...(to && { lt: new Date(Date.parse(`${to}T00:00:00+01:00`) + DAY) }),
        },
      }
    : {};

async function listRequests(actor, query) {
  const scope = ScopeService.resolve(actor);
  const where = {
    AND: [
      await repository.visibility(scope, 'request'),
      {
        ...(query.capability && { capability: query.capability }),
        ...(query.status && { status: query.status }),
        ...(query.subjectId && { subjectId: query.subjectId }),
        ...dateRange(query.from, query.to),
      },
    ],
  };
  const [rows, total] = await repository.listRequests(prisma, where, query);
  const subjects = await names(scope.agencyId, rows);
  return {
    data: rows.map((row) => requestView(row, subjects)),
    // `enabled` lets the web app hide every AI button when the module is off.
    meta: { ...pageMeta(query, total), enabled: aiConfig.enabled() },
  };
}

function suggestionView(row, subjects) {
  return {
    id: row.id,
    requestId: row.requestId,
    capability: row.capability,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    subjectName: subjects.get(row.subjectId) ?? null,
    status: row.status,
    modelVersion: row.modelVersion,
    fallback: row.modelVersion.includes('deterministic-fallback'),
    confidence: number(row.confidence),
    failure: failureOf(row.output),
    filters: row.request?.filters ?? null,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
  };
}

async function listSuggestions(actor, query) {
  const scope = ScopeService.resolve(actor);
  const where = {
    AND: [
      await repository.visibility(scope, 'suggestion'),
      {
        ...(query.capability && { capability: query.capability }),
        ...(query.status && { status: query.status }),
        ...(query.subjectId && { subjectId: query.subjectId }),
        ...dateRange(query.from, query.to),
      },
    ],
  };
  const [rows, total] = await repository.listSuggestions(prisma, where, query);
  const subjects = await names(scope.agencyId, rows);
  return { data: rows.map((row) => suggestionView(row, subjects)), meta: pageMeta(query, total) };
}

async function detail(actor, row) {
  const subjects = await names(row.agencyId, [row]);
  const kpis = await reportingService
    .aggregates(actor, reportFilters(row.request.filters))
    .catch((err) => (err instanceof NotFoundError ? null : Promise.reject(err)));
  return {
    ...suggestionView(row, subjects),
    output: row.output,
    reviewNote: row.reviewNote,
    reviewedBy: row.reviewedBy ? { id: row.reviewedBy.id, name: row.reviewedBy.fullName } : null,
    labels: await resolveLabels(row.agencyId, row.request.labelMap),
    request: { status: row.request.status, requestedById: row.request.requestedById },
    kpis,
  };
}

async function getSuggestion(actor, id) {
  const scope = ScopeService.resolve(actor);
  const row = await repository.findSuggestion(prisma, {
    AND: [await repository.visibility(scope, 'suggestion'), { id }],
  });
  if (!row) throw new NotFoundError();
  return detail(actor, row);
}

function review(actor, id, decision, note, req) {
  return withTransaction(async (tx) => {
    const scope = ScopeService.resolve(actor);
    const row = await repository.findSuggestion(tx, {
      AND: [await repository.visibility(scope, 'suggestion'), { id }],
    });
    if (!row) throw new NotFoundError();
    if (decision === 'accepted' && failureOf(row.output))
      throw new AppError({
        status: 422,
        code: ERROR_CODES.BUSINESS_RULE_VIOLATION,
        message: 'A failed AI output can only be rejected',
      });
    const { count } = await tx.aiSuggestion.updateMany({
      where: { id, status: 'pending_review' },
      data: {
        status: decision,
        reviewedById: actor.id,
        reviewedAt: clock.now(),
        reviewNote: note ?? null,
      },
    });
    if (!count)
      throw new AppError({
        status: 422,
        code: ERROR_CODES.AI_SUGGESTION_NOT_PENDING,
        message: 'The suggestion was already reviewed',
      });
    await auditService.record(tx, {
      actor,
      req,
      action: `ai.suggestion_${decision}`,
      entityType: 'ai_suggestion',
      entityId: id,
      before: { status: 'pending_review' },
      after: { status: decision, hasNote: Boolean(note) },
    });
    events.emit(tx, 'ai.suggestion_reviewed', {
      agencyId: actor.agencyId,
      actorId: actor.id,
      suggestionId: id,
      capability: row.capability,
      requesterId: row.request.requestedById,
      decision,
    });
    return { id, status: decision };
  });
}

/** The latest accepted suggestion for a dashboard card, or null. Same visibility as the review list. */
async function commentary(actor, { capability, subjectId }) {
  const scope = ScopeService.resolve(actor);
  if (scope.level === 'self' || scope.level === 'client') return null;
  const row = await repository.latestAccepted(prisma, {
    AND: [await repository.visibility(scope, 'suggestion'), { capability, subjectId }],
  });
  return row ? detail(actor, row) : null;
}

const textOf = (value) => (typeof value === 'string' ? value : (value?.text ?? ''));

/** The readable text of an output, for exports: headline, narrative and bullet lists, no labels. */
function plainText(output) {
  const lines = [output.headline, output.narrative];
  for (const key of ['summary', 'risks', 'opportunities', 'decisions', 'recommendedActions']) {
    if (Array.isArray(output[key])) lines.push(...output[key].map(textOf));
  }
  return lines.filter((line) => typeof line === 'string' && line.trim()).join('\n');
}

/**
 * The latest accepted campaign_insights text for the final report (Excel Summary sheet), or null.
 * @returns {Promise<{ text: string, reviewedBy: string | null, reviewedAt: Date } | null>}
 */
async function acceptedNarrative(actor, campaignId) {
  const row = await commentary(actor, { capability: 'campaign_insights', subjectId: campaignId });
  if (!row || row.failure) return null;
  return {
    text: plainText(row.output),
    reviewedBy: row.reviewedBy?.name ?? null,
    reviewedAt: row.reviewedAt,
  };
}

export const aiService = Object.freeze({
  acceptedNarrative,
  requestSuggestion,
  scheduleDailySummaries,
  processRequest,
  receiveResult,
  listRequests,
  listSuggestions,
  getSuggestion,
  accept: (actor, id, { note }, req) => review(actor, id, 'accepted', note, req),
  reject: (actor, id, { note }, req) => review(actor, id, 'rejected', note, req),
  commentary,
});
