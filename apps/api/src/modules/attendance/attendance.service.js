import { ERROR_CODES, haversineMeters, slotStatus } from '@fieldflow/shared';
import { auditService } from '../../core/audit/index.js';
import { ScopeService, SYSTEM_SCOPE } from '../../core/authz/scopeService.js';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../core/errors/index.js';
import { events } from '../../core/events/index.js';
import { runIdempotent } from '../../core/http/idempotency.js';
import { businessDate, clock } from '../../core/time/clock.js';
import { assertFieldEntry } from '../../core/time/fieldEntry.js';
import { prisma } from '../../db/client.js';
import { withTransaction } from '../../db/transaction.js';
import { ruleSetsService } from '../campaigns/ruleSets.service.js';
import { fileService } from '../files/files.service.js';
import * as repository from './attendance.repository.js';
import {
  algiersInstant,
  activeAssignments,
  asDate,
  assignmentSummary,
  attendanceRuleOf,
  coversDay,
  dateText,
  expectedCheckpoints,
} from './expected.js';

export const problem = (code, status, message, details) =>
  new AppError({ code: ERROR_CODES[code], status, message, details });

export function required(value) {
  if (!value) throw new NotFoundError();
  return value;
}

export function viewRecord(row) {
  const { assignment, ruleSet, ...data } = row;
  const rule = attendanceRuleOf(ruleSet);
  const flags = [];
  const limit = rule?.maxDistanceMeters;
  if (row.isLate) flags.push('late');
  if (limit != null && row.distanceM != null && row.distanceM > limit) flags.push('far_from_pos');
  if (limit != null && row.gpsAccuracyM != null && row.gpsAccuracyM > limit)
    flags.push('low_gps_accuracy');
  if (assignment.pointOfSale.latitude == null || assignment.pointOfSale.longitude == null) {
    flags.push('pos_without_location');
  }
  return {
    ...data,
    flags,
    workDate: dateText(row.workDate),
    animateur: assignment.animateur,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    window: rule?.checkpoints.find(({ code }) => code === row.checkpoint)?.window ?? null,
  };
}

function mapDuplicate(error, constraint, code, message) {
  if (error.details?.constraint === constraint) throw problem(code, 409, message);
  throw error;
}

function assertEntry(reason) {
  if (reason)
    throw problem('FIELD_ENTRY_NOT_ALLOWED', 422, 'Field entry is unavailable', { reason });
}

export async function recordCheckpoint(req) {
  const { actor, body, file, params } = req;
  const scope = ScopeService.resolve(actor);
  const recordedAt = clock.now();
  const date = businessDate(recordedAt);
  const workDate = asDate(date);
  try {
    return await runIdempotent(
      req,
      async (tx) => {
        const assignment = required(await repository.assignment(tx, scope, params.id));
        if (assignment.animateurId !== actor.id) {
          throw problem('NOT_ASSIGNMENT_OWNER', 404, 'Assignment not found');
        }
        await repository.lockCampaign(tx, scope, assignment.campaignId);
        const row = required(await repository.lockAssignment(tx, scope, params.id));
        assertFieldEntry(row, date);
        const version = await ruleSetsService.effective(
          { level: 'agency', agencyId: scope.agencyId },
          row.campaignId,
          recordedAt,
          tx,
        );
        const rule = attendanceRuleOf(version);
        const checkpoint = rule?.checkpoints.find(({ code }) => code === body.checkpoint);
        if (!checkpoint) throw problem('UNKNOWN_CHECKPOINT', 422, 'Unknown attendance checkpoint');
        const opensAt = algiersInstant(date, checkpoint.window[0]);
        if (recordedAt < opensAt) {
          throw problem('CHECKPOINT_NOT_OPEN', 422, 'Checkpoint has not opened', { opensAt });
        }
        if (checkpoint.photo && !file) throw problem('PHOTO_REQUIRED', 422, 'Photo is required');
        const photo =
          file &&
          (await fileService.store(tx, { actor, kind: 'attendance_photo', buffer: file.buffer }));
        const { latitude, longitude, gpsAccuracyM } = body;
        if (checkpoint.gps && [latitude, longitude, gpsAccuracyM].some((part) => part == null)) {
          throw problem('GPS_REQUIRED', 422, 'Coordinates and accuracy are required');
        }
        if (
          (latitude == null) !== (longitude == null) ||
          (latitude == null && gpsAccuracyM != null)
        ) {
          throw new ValidationError([
            { path: 'body.latitude', message: 'Supply both coordinates' },
          ]);
        }
        if (
          (await repository.absences(tx, scope, { assignmentId: row.id, workDate, voidedAt: null }))
            .length
        ) {
          throw problem(
            'ABSENCE_CONFLICTS_ATTENDANCE',
            409,
            'An active absence already covers this date',
          );
        }
        const place = row.pointOfSale;
        const distanceM = [latitude, longitude, place.latitude, place.longitude].some(
          (part) => part == null,
        )
          ? null
          : Math.round(haversineMeters({ latitude, longitude }, place));
        const record = await repository.createRecord(tx, scope, {
          assignmentId: row.id,
          campaignId: row.campaignId,
          animateurId: row.animateurId,
          pointOfSaleId: row.pointOfSaleId,
          workDate,
          checkpoint: checkpoint.code,
          recordedAt,
          ruleSetId: version.id,
          isLate: +recordedAt > +opensAt + rule.lateToleranceMinutes * 60_000,
          photoFileId: photo?.id,
          latitude,
          longitude,
          gpsAccuracyM,
          distanceM,
        });
        events.emit(tx, 'attendance.recorded', {
          agencyId: actor.agencyId,
          actorId: actor.id,
          campaignId: row.campaignId,
          assignmentId: row.id,
          attendanceId: record.id,
          photoFileId: record.photoFileId,
        });
        return viewRecord(record);
      },
      { status: 201, transaction: fileService.transaction },
    );
  } catch (error) {
    return mapDuplicate(
      error,
      'attendance_records_assignment_id_work_date_checkpoint_key',
      'CHECKPOINT_ALREADY_RECORDED',
      'Checkpoint is already recorded',
    );
  }
}

export async function recordAbsence(req) {
  const { actor, body, params } = req;
  const scope = ScopeService.resolve(actor);
  const workDate = asDate(body.workDate);
  try {
    return await runIdempotent(
      req,
      async (tx) => {
        const row = required(await repository.lockAssignment(tx, scope, params.id));
        required(await repository.assignmentVisible(tx, scope, row, body.workDate));
        if (!coversDay(row, body.workDate)) assertEntry('outside_assignment_work_days');
        if (body.replacementAssignmentId) {
          const replacement = await repository.assignment(tx, scope, body.replacementAssignmentId);
          if (
            !replacement ||
            replacement.id === row.id ||
            replacement.status !== 'approved' ||
            replacement.campaignId !== row.campaignId ||
            replacement.pointOfSaleId !== row.pointOfSaleId ||
            !coversDay(replacement, body.workDate)
          ) {
            throw problem('INVALID_REPLACEMENT', 422, 'Invalid replacement assignment');
          }
        }
        const conflict = await repository.records(
          tx,
          scope,
          {
            assignmentId: row.id,
            workDate,
            status: { in: ['verified', 'pending'] },
          },
          1,
        );
        if (conflict.length) {
          throw problem(
            'ABSENCE_CONFLICTS_ATTENDANCE',
            409,
            'Attendance already exists on this date',
          );
        }
        const result = await repository.createAbsence(tx, scope, {
          ...body,
          workDate,
          assignmentId: row.id,
          animateurId: row.animateurId,
          recordedById: actor.id,
        });
        events.emit(tx, 'absence.recorded', {
          agencyId: actor.agencyId,
          actorId: actor.id,
          campaignId: row.campaignId,
          assignmentId: row.id,
          absenceId: result.id,
        });
        return { ...result, workDate: body.workDate };
      },
      { status: 201 },
    );
  } catch (error) {
    return mapDuplicate(
      error,
      'absences_one_active_per_day',
      'ABSENCE_ALREADY_RECORDED',
      'An active absence already covers this date',
    );
  }
}

export function voidAbsence(actor, id, reason) {
  if (actor.role !== 'director') throw new ForbiddenError();
  const scope = ScopeService.resolve(actor);
  return withTransaction(async (tx) => {
    const [before] = await repository.absences(tx, scope, { id });
    required(before);
    const data = { voidedAt: clock.now(), voidedById: actor.id, voidReason: reason };
    const { count } = await repository.voidAbsence(tx, scope, id, data);
    if (!count) throw problem('ABSENCE_ALREADY_VOIDED', 409, 'Absence is already voided');
    await auditService.record(tx, {
      actor,
      action: 'absence.voided',
      entityType: 'absence',
      entityId: id,
      before: { voidedAt: null, voidedById: null, voidReason: null },
      after: data,
    });
    return { ...before, ...data, workDate: dateText(before.workDate) };
  });
}

export function review(actor, id, status, note = null, { override = false, campaignId } = {}) {
  if (override && actor.role !== 'director') throw new ForbiddenError();
  const scope = ScopeService.resolve(actor);
  return withTransaction(async (tx) => {
    const row = required(await repository.record(tx, scope, id));
    if (campaignId) required(row.campaignId === campaignId);
    if (row.animateurId === actor.id) {
      throw problem('NOT_ATTENDANCE_REVIEWER', 403, 'You cannot review your own proof');
    }
    required(await repository.assignmentVisible(tx, scope, row.assignment, dateText(row.workDate)));
    if (override && status === 'verified') {
      await repository.lockAssignment(tx, scope, row.assignmentId);
      const absences = await repository.absences(tx, scope, {
        assignmentId: row.assignmentId,
        workDate: row.workDate,
        voidedAt: null,
      });
      if (absences.length) {
        throw problem(
          'ABSENCE_CONFLICTS_ATTENDANCE',
          409,
          'An active absence already covers this date',
        );
      }
    }
    const current = required(await repository.lockRecord(tx, scope, id));
    const previous = override ? (status === 'verified' ? 'rejected' : 'verified') : 'pending';
    const data = { status, reviewedById: actor.id, reviewedAt: clock.now(), reviewNote: note };
    const { count } = await repository.updateRecord(tx, scope, id, previous, data);
    if (!count)
      throw problem('ATTENDANCE_NOT_PENDING', 409, 'Attendance cannot change from this status');
    await auditService.record(tx, {
      actor,
      action: override ? 'attendance.overridden' : 'attendance.reviewed',
      entityType: 'attendance',
      entityId: id,
      before: {
        status: current.status,
        reviewedById: current.reviewedById,
        reviewedAt: current.reviewedAt,
        reviewNote: current.reviewNote,
      },
      after: data,
    });
    if (status === 'rejected') {
      events.emit(tx, 'attendance.rejected', {
        agencyId: actor.agencyId,
        actorId: actor.id,
        campaignId: row.campaignId,
        attendanceId: id,
        animateurId: row.animateurId,
        reason: note,
      });
    }
    return viewRecord({ ...row, ...data });
  });
}

export async function verifyBulk(actor, campaignId, ids) {
  const verified = [];
  const skipped = [];
  for (const id of ids) {
    try {
      await review(actor, id, 'verified', null, { campaignId });
      verified.push(id);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      skipped.push({ id, code: error.code });
    }
  }
  return { verified, skipped };
}

export async function scopedRecord(db, scope, id) {
  const row = required(await repository.record(db, scope, id));
  required(await repository.assignmentVisible(db, scope, row.assignment, dateText(row.workDate)));
  return row;
}

export async function detail(actor, id) {
  const scope = ScopeService.resolve(actor);
  const row = await scopedRecord(prisma, scope, id);
  const reviewHistory = await repository.history(prisma, scope, 'attendance', id);
  const absences = await repository.absences(prisma, scope, {
    assignmentId: row.assignmentId,
    workDate: row.workDate,
  });
  return {
    ...viewRecord(row),
    reviewHistory,
    absences: absences.map((item) => ({ ...item, workDate: dateText(item.workDate) })),
  };
}

export async function board(actor, campaignId, date, instant = clock.now()) {
  const scope = ScopeService.resolve(actor);
  const workDate = asDate(date);
  const records = [];
  for (const row of await repository.records(prisma, scope, { workDate, campaignId })) {
    if (await repository.assignmentVisible(prisma, scope, row.assignment, date)) records.push(row);
  }
  let campaign = await repository.campaign(prisma, scope, campaignId);
  if (!campaign) {
    const assignments = await activeAssignments(prisma, scope, date, { campaignId });
    for (const row of assignments) {
      if (!(await repository.assignmentVisible(prisma, scope, row, date))) continue;
      campaign = await repository.agencyCampaign(prisma, scope, campaignId);
      break;
    }
    if (!campaign && records.length)
      campaign = await repository.agencyCampaign(prisma, scope, campaignId);
  }
  required(campaign);
  const expected = await expectedCheckpoints(prisma, scope, campaign, date, instant);
  const rowById = new Map(expected.map((row) => [row.assignmentId, row]));
  const bySlot = new Map();
  for (const row of records) {
    bySlot.set(row.assignmentId + ':' + row.checkpoint, viewRecord(row));
    if (!rowById.has(row.assignmentId)) {
      rowById.set(row.assignmentId, { ...assignmentSummary(row.assignment), checkpoints: [] });
    }
    const target = rowById.get(row.assignmentId);
    if (!target.checkpoints.some(({ code }) => code === row.checkpoint)) {
      const checkpoint = attendanceRuleOf(row.ruleSet)?.checkpoints.find(
        ({ code }) => code === row.checkpoint,
      );
      if (checkpoint)
        target.checkpoints.push({
          ...checkpoint,
          opensAt: algiersInstant(date, checkpoint.window[0]),
          isOpen: false,
        });
    }
  }
  const absences = await repository.absences(prisma, scope, {
    assignmentId: { in: [...rowById.keys()] },
    workDate,
  });
  const byAssignment = Map.groupBy(absences, (row) => row.assignmentId);
  const counters = {
    not_sent: 0,
    pending: 0,
    verified: 0,
    rejected: 0,
    absent_justified: 0,
    absent_unjustified: 0,
    late: 0,
  };
  const rows = [...rowById.values()].map((row) => {
    const absenceHistory = (byAssignment.get(row.assignmentId) ?? []).map((item) => ({
      ...item,
      workDate: dateText(item.workDate),
    }));
    return {
      ...row,
      absenceHistory,
      checkpoints: row.checkpoints.map((checkpoint) => {
        const record = bySlot.get(row.assignmentId + ':' + checkpoint.code);
        const slot = slotStatus(
          checkpoint,
          record,
          absenceHistory.find((item) => !item.voidedAt),
        );
        counters[slot.status]++;
        if (slot.isLate) counters.late++;
        return {
          ...checkpoint,
          ...slot,
          record: record ?? null,
          thumbnailFileId: record?.photoFileId ?? null,
        };
      }),
    };
  });
  return { date, campaignId, campaignName: campaign.name, rows, counters };
}

export async function recordList(actor, campaignId, filters) {
  const scope = ScopeService.resolve(actor);
  const { from, to, flag, ...where } = filters;
  const rows = await repository.records(prisma, scope, {
    campaignId,
    workDate: { gte: asDate(from), lte: asDate(to) },
  });
  const result = [];
  let visible = false;
  for (const row of rows) {
    if (await repository.assignmentVisible(prisma, scope, row.assignment, dateText(row.workDate))) {
      visible = true;
      if (Object.entries(where).some(([key, value]) => row[key] !== value)) continue;
      const value = viewRecord(row);
      if (!flag || value.flags.includes(flag)) result.push(value);
    }
  }
  if (!visible) required(await repository.campaign(prisma, scope, campaignId));
  return result;
}

export async function todayOverview(actor, forReview = false) {
  const scope = ScopeService.resolve(actor);
  const instant = clock.now();
  const date = businessDate(instant);
  const assignments = await repository.assignments(
    prisma,
    scope,
    forReview
      ? {
          OR: [
            { status: 'approved' },
            { attendanceRecords: { some: { workDate: asDate(date), status: 'pending' } } },
          ],
        }
      : { animateurId: actor.id, status: 'approved' },
  );
  const campaigns = new Set();
  for (const row of assignments) {
    if (coversDay(row, date) && (await repository.assignmentVisible(prisma, scope, row, date))) {
      campaigns.add(row.campaignId);
    }
  }
  const result = [];
  for (const campaignId of campaigns) {
    try {
      const daily = await board(actor, campaignId, date, instant);
      if (!forReview) result.push(...daily.rows);
      else {
        const pending = await recordList(actor, campaignId, {
          from: date,
          to: date,
          status: 'pending',
        });
        result.push({
          campaignId,
          campaignName: daily.campaignName,
          counters: daily.counters,
          pending: pending.filter((row) => row.animateurId !== actor.id),
        });
      }
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  return { date, [forReview ? 'campaigns' : 'assignments']: result };
}

export async function autoVerify() {
  const now = clock.now();
  let after;
  do {
    after = await withTransaction(async (tx) => {
      const candidates = await repository.records(
        tx,
        SYSTEM_SCOPE,
        {
          status: 'pending',
          id: after ? { gt: after } : undefined,
          recordedAt: { lte: new Date(+now - 3_600_000) },
        },
        100,
        { id: 'asc' },
      );
      for (const row of candidates) {
        const delay = attendanceRuleOf(row.ruleSet)?.autoVerifyAfterHours;
        if (
          delay == null ||
          +now - +row.recordedAt < delay * 3_600_000 ||
          viewRecord(row).flags.includes('far_from_pos')
        )
          continue;
        const data = {
          status: 'verified',
          reviewedById: null,
          reviewedAt: now,
          reviewNote: 'auto',
        };
        const { count } = await repository.updateRecord(tx, SYSTEM_SCOPE, row.id, 'pending', data);
        if (count)
          await auditService.record(tx, {
            actor: { type: 'system', agencyId: row.agencyId },
            action: 'attendance.auto_verified',
            entityType: 'attendance',
            entityId: row.id,
            before: { status: 'pending' },
            after: data,
          });
      }
      return candidates.length === 100 ? candidates.at(-1).id : undefined;
    });
  } while (after);
}
