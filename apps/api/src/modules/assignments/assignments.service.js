import { now, today } from '@fieldflow/shared';
import { auditService } from '../../core/audit/index.js';
import { ScopeService } from '../../core/authz/index.js';
import { AppError, ForbiddenError, NotFoundError } from '../../core/errors/index.js';
import { prisma } from '../../db/client.js';
import { withTransaction } from '../../db/transaction.js';
import {
  assignmentWhere,
  canApproveAssignment,
  canReadAssignment,
} from './assignments.policies.js';
import * as repo from './assignments.repository.js';

const accepting = new Set(['planning', 'assigned', 'active']);
const weekdays = [1, 2, 3, 4, 5, 6, 7];
const date = (value) => value.toISOString().slice(0, 10);
const shift = (value) => value?.toISOString().slice(11, 16) ?? null;
const error = (code, details, status = 422) =>
  new AppError({ code, details, status, message: code.toLowerCase().replaceAll('_', ' ') });
const visible = (actor, campaign) =>
  campaign &&
  (['director', 'general_manager'].includes(actor.role) ||
    campaign.wilayas.some(({ staff }) =>
      staff.some(({ userId, role }) => userId === actor.id && role === actor.role),
    ));
const staffFor = (campaign, wilayaId) =>
  campaign.wilayas.find((entry) => entry.wilayaId === wilayaId)?.staff ?? [];
const dateFilter = ({ from, to }) => ({
  ...(from ? { endDate: { gte: repo.asDate(from) } } : {}),
  ...(to ? { startDate: { lte: repo.asDate(to) } } : {}),
});

function serialize(row) {
  const { campaign, pointOfSale, ...fields } = row;
  return {
    ...fields,
    startDate: date(row.startDate),
    endDate: date(row.endDate),
    shiftStart: shift(row.shiftStart),
    shiftEnd: shift(row.shiftEnd),
    pointOfSale: {
      ...pointOfSale,
      latitude: pointOfSale.latitude == null ? null : Number(pointOfSale.latitude),
      longitude: pointOfSale.longitude == null ? null : Number(pointOfSale.longitude),
    },
    ...(campaign
      ? {
          campaign: {
            id: campaign.id,
            name: campaign.name,
            code: campaign.code,
            startDate: date(campaign.startDate),
            endDate: date(campaign.endDate),
          },
        }
      : {}),
  };
}

function gate(campaign, action) {
  if (
    accepting.has(campaign.status) ||
    (campaign.status === 'suspended' && ['cancel', 'end'].includes(action))
  )
    return;
  throw error('CAMPAIGN_NOT_ACCEPTING_ASSIGNMENTS', { status: campaign.status });
}

function approver(actor, campaign, wilayaId) {
  if (!canApproveAssignment(actor, campaign, wilayaId))
    throw error('NOT_ASSIGNMENT_APPROVER', undefined, 403);
}

async function requireCampaign(db, actor, id, lock = false) {
  const campaign = await repo.getCampaign(db, actor.agencyId, id, lock);
  if (!visible(actor, campaign)) {
    const own =
      campaign &&
      ['supervisor', 'animateur'].includes(actor.role) &&
      (await repo.countRows(db, { ...assignmentWhere(actor), campaignId: id }));
    if (!own) throw new NotFoundError();
  }
  return campaign;
}

function visibleWilaya(actor, campaign, wilayaId) {
  if (
    ['regional_manager', 'supervisor'].includes(actor.role) &&
    !staffFor(campaign, wilayaId).some(
      ({ userId, role }) => userId === actor.id && role === actor.role,
    )
  )
    throw new NotFoundError();
}

function conflictDetails(actor, row) {
  if (!row) return undefined;
  return {
    startDate: date(row.startDate),
    endDate: date(row.endDate),
    ...(row.campaign && canReadAssignment(actor, row, row.campaign)
      ? { campaignCode: row.campaign.code, pointOfSale: row.pointOfSale.name }
      : { label: 'another assignment' }),
  };
}

async function checkOverlap(db, actor, data) {
  const row = await repo.overlap(db, actor.agencyId, data);
  if (row) throw error('ASSIGNMENT_OVERLAP', { conflict: conflictDetails(actor, row) }, 409);
}

async function validateProposal(db, actor, campaign, input, { replacement = false } = {}) {
  const point = campaign.pointsOfSale.find(
    ({ pointOfSale }) => pointOfSale.id === input.pointOfSaleId,
  )?.pointOfSale;
  if (!point) throw error('POS_NOT_IN_CAMPAIGN');
  if (!replacement && actor.role === 'regional_manager')
    visibleWilaya(actor, campaign, point.wilayaId);
  const supervisorId = input.supervisorId ?? (actor.role === 'supervisor' ? actor.id : undefined);
  if (actor.role === 'supervisor' && supervisorId !== actor.id)
    throw error('SUPERVISOR_NOT_ON_WILAYA_STAFF');
  if (
    !staffFor(campaign, point.wilayaId).some(
      ({ role, userId }) => role === 'supervisor' && userId === supervisorId,
    )
  ) {
    throw error('SUPERVISOR_NOT_ON_WILAYA_STAFF');
  }
  await repo.lockUser(db, actor.agencyId, input.animateurId);
  const member = await repo.findAnimateur(
    db,
    ScopeService.resolve(actor),
    input.animateurId,
    actor.agencyId,
  );
  if (!member) throw new NotFoundError();
  if (member.role !== 'animateur') throw error('NOT_AN_ANIMATEUR');
  if (member.status !== 'active') throw error('USER_INACTIVE');
  if (input.startDate < today()) throw error('START_DATE_IN_PAST');
  if (
    input.startDate < date(campaign.startDate) ||
    input.endDate > date(campaign.endDate) ||
    input.endDate < input.startDate
  ) {
    throw error('DATES_OUTSIDE_CAMPAIGN');
  }
  const workDays = input.workDays ?? weekdays;
  if (
    !workDays.length ||
    new Set(workDays).size !== workDays.length ||
    workDays.some((day) => !weekdays.includes(day))
  ) {
    throw error('WORK_DAYS_INVALID');
  }
  if (
    Boolean(input.shiftStart) !== Boolean(input.shiftEnd) ||
    (input.shiftStart && input.shiftStart >= input.shiftEnd)
  ) {
    throw error('SHIFT_INVALID');
  }
  return {
    animateurId: input.animateurId,
    pointOfSaleId: input.pointOfSaleId,
    campaignId: campaign.id,
    supervisorId,
    startDate: repo.asDate(input.startDate),
    endDate: repo.asDate(input.endDate),
    workDays,
    shiftStart: input.shiftStart ? repo.asDate('1970-01-01T' + input.shiftStart + ':00Z') : null,
    shiftEnd: input.shiftEnd ? repo.asDate('1970-01-01T' + input.shiftEnd + ':00Z') : null,
    proposedById: actor.id,
  };
}

const itemError = (err, index, batch) =>
  batch && err instanceof AppError
    ? error(err.code, { items: [{ index, code: err.code, details: err.details }] }, err.status)
    : err;

function rejectInvalidItems(failures) {
  if (!failures.length) return;
  const { err: first } = failures[0];
  throw error(
    first.code,
    { items: failures.map(({ err, index }) => ({ index, code: err.code, details: err.details })) },
    first.status,
  );
}

async function audit(db, actor, action, row, before, after) {
  await auditService.record(db, {
    actor,
    action: 'assignment.' + action,
    entityType: 'assignment',
    entityId: row.id,
    before,
    after,
  });
}

async function propose(actor, campaignId, items, batch = false) {
  let attempt;
  let index = 0;
  try {
    return await withTransaction(async (db) => {
      const campaign = await requireCampaign(db, actor, campaignId, true);
      gate(campaign, 'propose');
      const inputs = [];
      const failures = [];
      for (const [i, item] of items.entries()) {
        try {
          const data = await validateProposal(db, actor, campaign, item);
          await checkOverlap(db, actor, data);
          const prior = inputs.find(
            (other) =>
              other.animateurId === data.animateurId &&
              other.startDate <= data.endDate &&
              other.endDate >= data.startDate,
          );
          if (prior)
            throw error('ASSIGNMENT_OVERLAP', { conflict: conflictDetails(actor, prior) }, 409);
          inputs.push(data);
        } catch (err) {
          if (!batch || !(err instanceof AppError)) throw err;
          failures.push({ err, index: i });
        }
      }
      rejectInvalidItems(failures);
      const rows = [];
      for (const [i, data] of inputs.entries()) {
        attempt = data;
        index = i;
        const row = await repo.create(db, actor.agencyId, data);
        await audit(db, actor, 'proposed', row, undefined, serialize(row));
        rows.push(serialize(row));
      }
      return batch ? rows : rows[0];
    });
  } catch (err) {
    if (err.details?.constraint === 'assignments_no_overlap' && attempt) {
      const conflict = await repo.overlap(prisma, actor.agencyId, attempt);
      throw itemError(
        error('ASSIGNMENT_OVERLAP', { conflict: conflictDetails(actor, conflict) }, 409),
        index,
        batch,
      );
    }
    throw err;
  }
}

async function lockedRow(db, actor, id) {
  const initial = await repo.getRow(db, actor.agencyId, id);
  if (!initial) throw new NotFoundError();
  const campaign = await repo.getCampaign(db, actor.agencyId, initial.campaignId, true);
  const row = await repo.getRow(db, actor.agencyId, id, true);
  if (!row || !campaign || !canReadAssignment(actor, row, campaign)) throw new NotFoundError();
  return { row, campaign };
}

async function change(db, actor, row, action, data) {
  const next = await repo.update(db, actor.agencyId, row.id, data);
  await audit(db, actor, action, row, serialize(row), serialize(next));
  return serialize(next);
}

function decisionFields(actor, note) {
  return { decidedById: actor.id, decidedAt: now(), decisionNote: note ?? null };
}

function replacementDate(row, from) {
  const min = date(row.startDate);
  if (row.status !== 'approved' || from <= today() || from < min || from > date(row.endDate)) {
    throw error('REPLACEMENT_DATE_INVALID');
  }
}

function shorten(db, actor, row, from, reason) {
  if (from === date(row.startDate))
    return change(db, actor, row, 'cancelled', {
      status: 'cancelled',
      ...decisionFields(actor, reason),
    });
  const endDate = repo.asDate(from);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  return change(db, actor, row, 'ended', { endDate, ...decisionFields(actor, reason) });
}

async function decide(actor, items, batch = false) {
  return withTransaction(async (db) => {
    const staged = [];
    const failures = [];
    const existing = new Map();
    const campaigns = new Map();
    for (const id of [...new Set(items.map(({ id }) => id))].sort()) {
      const row = await repo.getRow(db, actor.agencyId, id);
      if (row) existing.set(id, row);
    }
    for (const id of [
      ...new Set(Array.from(existing.values(), ({ campaignId }) => campaignId)),
    ].sort()) {
      campaigns.set(id, await repo.getCampaign(db, actor.agencyId, id, true));
    }
    const locked = new Map();
    const ids = [
      ...existing.keys(),
      ...Array.from(existing.values(), ({ replacesAssignmentId }) => replacesAssignmentId).filter(
        Boolean,
      ),
    ];
    for (const id of [...new Set(ids)].sort())
      locked.set(id, await repo.getRow(db, actor.agencyId, id, true));
    const seen = new Set();
    const replacements = new Set();
    for (const [index, input] of items.entries()) {
      try {
        const { id, decision, note } = input;
        if (seen.has(id)) throw error('ASSIGNMENT_NOT_PROPOSED');
        seen.add(id);
        const row = locked.get(id);
        const campaign = row && campaigns.get(row.campaignId);
        if (!campaign || !canReadAssignment(actor, row, campaign)) throw new NotFoundError();
        approver(actor, campaign, row.pointOfSale.wilayaId);
        gate(campaign, decision);
        if (row.status !== 'proposed') throw error('ASSIGNMENT_NOT_PROPOSED');
        if (decision === 'approve' && row.animateur.status !== 'active')
          throw error('USER_INACTIVE');
        if (decision === 'reject' && !note) throw error('NOTE_REQUIRED');
        let original;
        if (row.replacesAssignmentId && decision === 'approve') {
          original = locked.get(row.replacesAssignmentId);
          if (!original || replacements.has(original.id)) throw error('REPLACEMENT_DATE_INVALID');
          replacementDate(original, date(row.startDate));
          replacements.add(original.id);
        }
        staged.push({ row, original, decision, note });
      } catch (err) {
        if (!batch || !(err instanceof AppError)) throw err;
        failures.push({ err, index });
      }
    }
    rejectInvalidItems(failures);
    const result = [];
    for (const { row, original, decision, note } of staged) {
      if (original)
        await shorten(db, actor, original, date(row.startDate), note ?? row.decisionNote);
      const status = decision === 'approve' ? 'approved' : 'rejected';
      result.push(
        await change(db, actor, row, status, {
          status,
          ...decisionFields(actor, note ?? row.decisionNote),
        }),
      );
    }
    return batch ? result : result[0];
  });
}

async function mutate(actor, id, action, input = {}) {
  let attempt;
  try {
    return await withTransaction(async (db) => {
      const { row, campaign } = await lockedRow(db, actor, id);
      const allowed = canApproveAssignment(actor, campaign, row.pointOfSale.wilayaId);
      gate(campaign, action);
      if (action === 'cancel') {
        if (row.status === 'proposed') {
          if (row.proposedById !== actor.id) approver(actor, campaign, row.pointOfSale.wilayaId);
          return change(db, actor, row, 'cancelled', {
            status: 'cancelled',
            ...decisionFields(actor, input.note),
          });
        }
        if (row.status !== 'approved') throw error('ASSIGNMENT_NOT_PROPOSED');
        approver(actor, campaign, row.pointOfSale.wilayaId);
        if (date(row.startDate) <= today()) throw error('ASSIGNMENT_ALREADY_STARTED');
        return change(db, actor, row, 'cancelled', {
          status: 'cancelled',
          ...decisionFields(actor, input.note),
        });
      }
      if (action === 'end') {
        approver(actor, campaign, row.pointOfSale.wilayaId);
        if (
          row.status !== 'approved' ||
          input.endDate < today() ||
          input.endDate < date(row.startDate) ||
          input.endDate >= date(row.endDate)
        )
          throw error('INVALID_END_DATE');
        return change(db, actor, row, 'ended', {
          endDate: repo.asDate(input.endDate),
          ...decisionFields(actor, input.reason),
        });
      }
      if (!allowed && (actor.role !== 'supervisor' || row.supervisorId !== actor.id))
        throw new ForbiddenError();
      replacementDate(row, input.fromDate);
      if (row.animateurId === input.animateurId) throw error('REPLACEMENT_DATE_INVALID');
      attempt = await validateProposal(
        db,
        actor,
        campaign,
        {
          animateurId: input.animateurId,
          startDate: input.fromDate,
          endDate: date(row.endDate),
          pointOfSaleId: row.pointOfSaleId,
          supervisorId: row.supervisorId,
          workDays: row.workDays?.length ? row.workDays : undefined,
          shiftStart: shift(row.shiftStart),
          shiftEnd: shift(row.shiftEnd),
        },
        { replacement: true },
      );
      await checkOverlap(db, actor, attempt);
      if (allowed) await shorten(db, actor, row, input.fromDate, input.reason);
      const next = await repo.create(db, actor.agencyId, {
        ...attempt,
        replacesAssignmentId: id,
        ...(allowed
          ? { status: 'approved', ...decisionFields(actor, input.reason) }
          : { decisionNote: input.reason }),
      });
      await audit(db, actor, 'replacement', next, undefined, serialize(next));
      return serialize(next);
    });
  } catch (err) {
    if (err.details?.constraint !== 'assignments_no_overlap' || !attempt) throw err;
    const conflict = await repo.overlap(prisma, actor.agencyId, attempt);
    throw error('ASSIGNMENT_OVERLAP', { conflict: conflictDetails(actor, conflict) }, 409);
  }
}

async function paginate(where, { page, pageSize }) {
  const [rows, total] = await Promise.all([
    repo.list(prisma, where, { skip: (page - 1) * pageSize, take: pageSize }),
    repo.countRows(prisma, where),
  ]);
  return { data: rows.map(serialize), meta: { page, pageSize, total } };
}

async function list(actor, campaignId, filters) {
  const campaign = await requireCampaign(prisma, actor, campaignId);
  const { status, wilayaId, pointOfSaleId, supervisorId, animateurId } = filters;
  const area =
    actor.role === 'regional_manager'
      ? {
          pointOfSale: {
            wilayaId: {
              in: campaign.wilayas
                .filter(({ staff }) =>
                  staff.some(
                    ({ userId, role }) => userId === actor.id && role === 'regional_manager',
                  ),
                )
                .map(({ wilayaId }) => wilayaId),
            },
          },
        }
      : {};
  return paginate(
    {
      AND: [
        assignmentWhere(actor),
        area,
        {
          campaignId,
          status,
          pointOfSaleId,
          supervisorId,
          animateurId,
          ...(wilayaId ? { pointOfSale: { wilayaId } } : {}),
          ...dateFilter(filters),
        },
      ],
    },
    filters,
  );
}

async function pending(actor, filters) {
  const roles = {
    director: undefined,
    general_manager: { in: ['general_manager', 'regional_manager'] },
    regional_manager: 'regional_manager',
  };
  const regional =
    actor.role === 'regional_manager' ? { OR: await repo.regionalAssignments(prisma, actor) } : {};
  return paginate(
    {
      agencyId: actor.agencyId,
      status: 'proposed',
      ...regional,
      campaign: { status: { in: [...accepting] }, assignmentApproverRole: roles[actor.role] },
    },
    filters,
  );
}

async function mine(actor) {
  if (actor.role !== 'animateur') throw new NotFoundError();
  const rows = await repo.list(prisma, {
    ...assignmentWhere(actor),
    status: 'approved',
    endDate: { gte: repo.asDate(today()) },
  });
  return rows.map(serialize);
}

async function candidates(actor, campaignId, { wilayaId, from, to, q }) {
  const campaign = await requireCampaign(prisma, actor, campaignId);
  visibleWilaya(actor, campaign, wilayaId);
  const people = await repo.candidates(prisma, ScopeService.resolve(actor), actor.agencyId, q);
  const now = repo.asDate(today());
  const conflicts = new Map();
  for (const row of await repo.getOverlaps(
    prisma,
    actor.agencyId,
    people.map(({ id }) => id),
    repo.asDate(from),
    repo.asDate(to),
  )) {
    if (!conflicts.has(row.animateurId)) conflicts.set(row.animateurId, row);
  }
  const rows = people.map(({ reportingLines, animateurAssignments, ...person }) => {
    const conflict = conflicts.get(person.id);
    return {
      ...person,
      available: !conflict,
      conflict: conflict ? conflictDetails(actor, conflict) : null,
      pastCampaigns: new Set(
        animateurAssignments
          .filter(({ endDate }) => endDate < now)
          .map(({ campaignId }) => campaignId),
      ).size,
      defaultSupervisor: reportingLines.some(
        ({ managerId, validFrom, validTo }) =>
          managerId === actor.id && validFrom <= now && (!validTo || validTo > now),
      ),
      rank: null,
    };
  });
  return rows.sort(
    (a, b) =>
      Number(b.available) - Number(a.available) ||
      Number(b.wilayaId === wilayaId) - Number(a.wilayaId === wilayaId),
  );
}

async function staffing(actor, campaignId, at = today()) {
  const weekday = repo.asDate(at).getUTCDay() || 7;
  const campaign = await requireCampaign(prisma, actor, campaignId);
  const rows = (
    await repo.list(prisma, {
      ...assignmentWhere(actor),
      campaignId,
      status: { in: repo.liveStatuses },
      ...dateFilter({ from: at, to: at }),
    })
  ).filter((row) => canReadAssignment(actor, row, campaign));
  return campaign.wilayas
    .filter(
      ({ staff }) =>
        !['regional_manager', 'supervisor'].includes(actor.role) ||
        staff.some(({ userId, role }) => userId === actor.id && role === actor.role),
    )
    .map(({ wilayaId, wilaya, requiredAnimateurs }) => {
      const local = rows.filter((row) => row.pointOfSale.wilayaId === wilayaId);
      const approved = local.filter(
        ({ status, workDays }) =>
          status === 'approved' && (!workDays?.length || workDays.includes(weekday)),
      );
      return {
        wilayaId,
        wilaya,
        requiredAnimateurs,
        approvedAnimateurs: new Set(approved.map(({ animateurId }) => animateurId)).size,
        proposedCount: local.filter(({ status }) => status === 'proposed').length,
        uncoveredPointsOfSale: campaign.pointsOfSale
          .map(({ pointOfSale }) => pointOfSale)
          .filter(
            (point) =>
              point.wilayaId === wilayaId &&
              !approved.some(({ pointOfSaleId }) => pointOfSaleId === point.id),
          )
          .map(({ id, name }) => ({ id, name })),
      };
    });
}

async function endAllForUser(db, actor, userId, day) {
  const at = repo.asDate(day);
  const rows = await repo.list(db, {
    agencyId: actor.agencyId,
    animateurId: userId,
    status: { in: repo.liveStatuses },
    endDate: { gte: at },
  });
  for (const campaignId of [...new Set(rows.map(({ campaignId }) => campaignId))].sort()) {
    await repo.getCampaign(db, actor.agencyId, campaignId, true);
  }
  for (const item of rows) {
    const row = await repo.getRow(db, actor.agencyId, item.id, true);
    if (!row || !repo.liveStatuses.includes(row.status) || row.endDate < at) continue;
    if (row.startDate > at || row.status === 'proposed') {
      await change(db, actor, row, 'cancelled', {
        status: 'cancelled',
        ...decisionFields(actor, 'User left'),
      });
    } else if (row.endDate > at) {
      await change(db, actor, row, 'ended', { endDate: at, ...decisionFields(actor, 'User left') });
    }
  }
}

export const assignmentService = {
  propose,
  decide,
  mutate,
  list,
  pending,
  mine,
  candidates,
  staffing,
  endAllForUser,
};
