// Queries of the AI module. Every read goes through `visibility`, built from the actor's scope:
// agency level sees the whole agency; a regional manager sees the requests they made and the daily
// summaries of supervisors in their team; a supervisor sees their own requests and their own daily
// summaries. Nobody sees a campaign-wide suggestion built from data wider than their own scope.
import { userWhere } from '../../core/authz/index.js';
import { assertScope } from '../../core/authz/scopeFilters.js';

const idsOf = (where) => (typeof where.id === 'string' ? [where.id] : (where.id?.in ?? []));

/**
 * @param {import('../../core/authz/scopeService.js').Scope} scope
 * @param {'request' | 'suggestion'} kind
 * @returns {Promise<object>} a Prisma `where` for ai_requests or ai_suggestions
 */
export async function visibility(scope, kind) {
  assertScope(scope);
  const { agencyId, level, userId } = scope;
  if (level === 'agency') return { agencyId };
  if (level !== 'regional' && level !== 'supervisor') return { agencyId, id: { in: [] } };
  const own =
    kind === 'request' ? { requestedById: userId } : { request: { is: { requestedById: userId } } };
  const team = level === 'regional' ? idsOf(await userWhere(scope)) : [userId];
  return {
    agencyId,
    OR: [own, { subjectType: 'supervisor', subjectId: { in: team } }],
  };
}

export function findRequestByRequestId(db, requestId) {
  return db.aiRequest.findUnique({ where: { requestId } });
}

export function findRequest(db, id) {
  return db.aiRequest.findUnique({ where: { id } });
}

export function findRecentRequest(
  db,
  { agencyId, capability, subjectId, filters, requestedById, since },
) {
  return db.aiRequest.findFirst({
    where: {
      agencyId,
      capability,
      subjectId,
      requestedById,
      filters: { equals: filters },
      status: { in: ['queued', 'sent'] },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export function createRequest(db, data) {
  return db.aiRequest.create({ data });
}

export function listRequests(db, where, { page, pageSize }) {
  return Promise.all([
    db.aiRequest.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { suggestion: { select: { id: true, status: true, output: true } } },
    }),
    db.aiRequest.count({ where }),
  ]);
}

export function listSuggestions(db, where, { page, pageSize }) {
  return Promise.all([
    db.aiSuggestion.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { request: { select: { filters: true, requestedById: true } } },
    }),
    db.aiSuggestion.count({ where }),
  ]);
}

export function findSuggestion(db, where) {
  return db.aiSuggestion.findFirst({
    where,
    include: {
      request: true,
      reviewedBy: { select: { id: true, fullName: true } },
    },
  });
}

export function latestAccepted(db, where) {
  return db.aiSuggestion.findFirst({
    where: { ...where, status: 'accepted' },
    orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
    include: { request: true, reviewedBy: { select: { id: true, fullName: true } } },
  });
}

/**
 * `INSERT … ON CONFLICT (request_id) DO NOTHING`: the second delivery of a callback inserts nothing.
 * @returns {Promise<string | null>} the new suggestion id, or null for a duplicate
 */
export async function insertSuggestion(tx, request, { modelVersion, confidence, output }) {
  const rows = await tx.$queryRaw`
    INSERT INTO ai_suggestions (agency_id, capability, subject_type, subject_id, request_id,
      model_version, confidence, output)
    VALUES (${request.agencyId}::uuid, ${request.capability}, ${request.subjectType},
      ${request.subjectId}::uuid, ${request.requestId}::uuid, ${modelVersion},
      ${confidence}::numeric(4,3), ${JSON.stringify(output)}::jsonb)
    ON CONFLICT (request_id) DO NOTHING
    RETURNING id`;
  return rows[0]?.id ?? null;
}

export function usersByIds(db, agencyId, ids) {
  return db.user.findMany({
    where: { agencyId, id: { in: ids } },
    select: { id: true, fullName: true },
  });
}

export function campaignsByIds(db, agencyId, ids) {
  return db.campaign.findMany({
    where: { agencyId, id: { in: ids } },
    select: { id: true, name: true },
  });
}

export function reviewerIds(db, agencyId) {
  return db.user.findMany({
    where: { agencyId, status: 'active', role: { in: ['director', 'general_manager'] } },
    select: { id: true },
  });
}

/** Supervisors with an approved assignment in an active campaign that covers `date`. */
export function supervisorsWorkingOn(db, date) {
  return db.assignment.findMany({
    where: {
      status: 'approved',
      startDate: { lte: new Date(date) },
      endDate: { gte: new Date(date) },
      campaign: {
        status: 'active',
        startDate: { lte: new Date(date) },
        endDate: { gte: new Date(date) },
      },
      supervisor: { status: 'active', role: 'supervisor' },
    },
    distinct: ['supervisorId'],
    select: { supervisorId: true, agencyId: true },
  });
}
