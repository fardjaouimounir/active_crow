// Supervisor teams (FR-031 extension): the director sets how many Animateurs each supervisor must
// bring; the supervisor then picks his existing Animateurs for the campaign, or creates a new one
// and picks him. A supervisor only ever sees and edits his own team.
import { ERROR_CODES } from '@fieldflow/shared';
import { auditService } from '../../core/audit/index.js';
import { ScopeService, scoped, userWhere } from '../../core/authz/index.js';
import { AppError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import { prisma } from '../../db/client.js';
import { withTransaction } from '../../db/transaction.js';
import { assignmentReadService } from '../assignments/assignmentReadService.js';
import { userManagementService } from '../organization/userManagement.service.js';
import * as repository from './campaigns.repository.js';
import { assertEditable } from './editPolicy.js';
import * as team from './team.repository.js';

const rule = (code, message, details) => new AppError({ status: 422, code, message, details });

const sum = (rows) => rows.reduce((total, row) => total + row.requiredAnimateurs, 0);

function audit(tx, actor, action, campaignId, before, after) {
  return auditService.record(tx, {
    actor,
    action: 'campaign.' + action,
    entityType: 'campaign',
    entityId: campaignId,
    before,
    after,
  });
}

async function lockedCampaign(tx, actor, id) {
  const campaign = await repository.lockCampaign(tx, { agencyId: actor.agencyId }, id);
  if (!campaign) throw new NotFoundError();
  assertEditable(campaign, 'coverage');
  return campaign;
}

/** Which supervisor's team an action is about, and whether the actor may act for them. */
async function resolveSupervisor(db, actor, campaignId, requested) {
  let supervisorId;
  if (actor.role === 'supervisor') {
    if (requested && requested !== actor.id) throw new NotFoundError();
    supervisorId = actor.id;
  } else {
    if (!requested) {
      throw new ValidationError([{ path: 'body.supervisorId', message: 'Choose a supervisor' }]);
    }
    supervisorId = requested;
  }
  const rows = await team.supervisorStaff(db, campaignId, supervisorId);
  if (!rows.length) {
    throw rule(
      ERROR_CODES.NOT_CAMPAIGN_SUPERVISOR,
      'This person is not a supervisor of the campaign',
    );
  }
  if (actor.role === 'regional_manager') {
    const mine = await team.staffedWilayaIds(db, campaignId, actor.id, 'regional_manager');
    if (!rows.some((row) => mine.includes(row.wilayaId))) throw new NotFoundError();
  }
  return { supervisorId, rows };
}

async function assertRoom(db, campaignId, supervisorId, rows) {
  const required = sum(rows);
  const count = await team.countTeam(db, campaignId, supervisorId);
  if (count >= required) {
    throw rule(
      ERROR_CODES.SUPERVISOR_QUOTA_REACHED,
      'The supervisor already has all the Animateurs the director asked for',
      { required, count },
    );
  }
}

/** The team members the actor may see: a supervisor his own, a regional manager his wilayas. */
async function list(actor, campaignId) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, agencyId: actor.agencyId },
    select: { id: true },
  });
  if (!campaign) throw new NotFoundError();
  let supervisorIds = null;
  if (actor.role === 'supervisor') supervisorIds = [actor.id];
  else if (actor.role === 'regional_manager') {
    const wilayaIds = await team.staffedWilayaIds(prisma, campaignId, actor.id, 'regional_manager');
    supervisorIds = await team.supervisorsOfWilayas(prisma, campaignId, wilayaIds);
  } else if (!['director', 'general_manager'].includes(actor.role)) throw new NotFoundError();
  return team.listTeam(prisma, campaignId, supervisorIds);
}

async function visibleAnimateur(tx, actor, animateurId) {
  const where = await userWhere(ScopeService.resolve(actor), { db: tx });
  const user = await tx.user.findFirst({
    where: scoped(where, { id: animateurId, agencyId: actor.agencyId }),
    select: { id: true, role: true, status: true },
  });
  if (!user) throw new NotFoundError();
  if (user.role !== 'animateur') {
    throw rule(ERROR_CODES.NOT_AN_ANIMATEUR, 'Only Animateurs can join a supervisor team');
  }
  if (user.status !== 'active') {
    throw rule(ERROR_CODES.USER_INACTIVE, 'The user is not active', { status: user.status });
  }
  return user;
}

async function insertMember(tx, actor, campaignId, supervisorId, animateurId) {
  if (await team.findMember(tx, campaignId, animateurId)) {
    throw rule(ERROR_CODES.ANIMATEUR_ALREADY_IN_TEAM, 'This Animateur is already in a team', {
      animateurId,
    });
  }
  const member = await team.addMember(
    tx,
    { agencyId: actor.agencyId },
    { campaignId, supervisorId, animateurId, addedById: actor.id },
  );
  await audit(tx, actor, 'team_member_added', campaignId, undefined, {
    supervisorId,
    animateurId,
  });
  return member;
}

/** Picks an existing Animateur for the supervisor's team. */
function add(actor, campaignId, { animateurId, supervisorId: requested }) {
  return withTransaction(async (tx) => {
    await lockedCampaign(tx, actor, campaignId);
    const { supervisorId, rows } = await resolveSupervisor(tx, actor, campaignId, requested);
    await assertRoom(tx, campaignId, supervisorId, rows);
    await visibleAnimateur(tx, actor, animateurId);
    return insertMember(tx, actor, campaignId, supervisorId, animateurId);
  });
}

/** Creates a new Animateur account (reporting to the supervisor) and puts him in the team. */
async function createAndAdd(actor, campaignId, { supervisorId: requested, ...data }) {
  const { supervisorId, rows } = await withTransaction(async (tx) => {
    await lockedCampaign(tx, actor, campaignId);
    const resolved = await resolveSupervisor(tx, actor, campaignId, requested);
    await assertRoom(tx, campaignId, resolved.supervisorId, resolved.rows);
    if (!resolved.rows.some((row) => row.wilayaId === data.wilayaId)) {
      throw rule(
        ERROR_CODES.WILAYA_NOT_IN_CAMPAIGN,
        'Choose one of the wilayas this supervisor covers in the campaign',
      );
    }
    return resolved;
  });
  const scope = ScopeService.resolve(actor);
  const { user, temporaryPassword } = await userManagementService.create(scope, actor, {
    ...data,
    role: 'animateur',
    managerId: supervisorId,
  });
  const member = await withTransaction(async (tx) => {
    await lockedCampaign(tx, actor, campaignId);
    await assertRoom(tx, campaignId, supervisorId, rows);
    return insertMember(tx, actor, campaignId, supervisorId, user.id);
  });
  return { member, user, temporaryPassword };
}

function remove(actor, campaignId, animateurId) {
  return withTransaction(async (tx) => {
    await lockedCampaign(tx, actor, campaignId);
    const member = await team.findMember(tx, campaignId, animateurId);
    if (!member) throw new NotFoundError();
    if (actor.role === 'supervisor' && member.supervisorId !== actor.id) throw new NotFoundError();
    if (actor.role === 'regional_manager') {
      await resolveSupervisor(tx, actor, campaignId, member.supervisorId);
    }
    const assignments = await assignmentReadService.countActiveForAnimateur(
      tx,
      campaignId,
      animateurId,
    );
    if (assignments > 0) {
      throw rule(
        ERROR_CODES.TEAM_MEMBER_HAS_ASSIGNMENTS,
        'This Animateur has proposed or approved assignments in the campaign',
        { assignments },
      );
    }
    await team.removeMember(tx, member.id);
    await audit(tx, actor, 'team_member_removed', campaignId, {
      supervisorId: member.supervisorId,
      animateurId,
    });
  });
}

/** Director: changes how many Animateurs a supervisor must bring (never below the current team). */
function setQuota(actor, campaignId, staffId, { requiredAnimateurs }) {
  return withTransaction(async (tx) => {
    await lockedCampaign(tx, actor, campaignId);
    const staff = await tx.campaignStaff.findFirst({
      where: { id: staffId, campaignId },
      select: { id: true, userId: true, wilayaId: true, role: true, requiredAnimateurs: true },
    });
    if (!staff) throw new NotFoundError();
    if (staff.role !== 'supervisor') {
      throw rule(
        ERROR_CODES.QUOTA_ONLY_FOR_SUPERVISORS,
        'Only supervisors have an Animateur quota',
      );
    }
    const rows = await team.supervisorStaff(tx, campaignId, staff.userId);
    const others = sum(rows.filter((row) => row.id !== staff.id));
    const count = await team.countTeam(tx, campaignId, staff.userId);
    if (others + requiredAnimateurs < count) {
      throw rule(
        ERROR_CODES.QUOTA_BELOW_TEAM_SIZE,
        'The quota cannot be lower than the Animateurs already chosen',
        { count },
      );
    }
    await team.setQuota(tx, staffId, requiredAnimateurs);
    await team.syncWilayaNeed(tx, campaignId, staff.wilayaId);
    await audit(
      tx,
      actor,
      'staff_quota_changed',
      campaignId,
      { staffId, requiredAnimateurs: staff.requiredAnimateurs },
      { staffId, requiredAnimateurs },
    );
    return { id: staffId, requiredAnimateurs };
  });
}

export const teamService = Object.freeze({ list, add, createAndAdd, remove, setQuota });
