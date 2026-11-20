import { randomBytes } from 'node:crypto';
import { ERROR_CODES } from '@fieldflow/shared';
import { auditService } from '../../core/audit/index.js';
import { hashPassword, revokeAllSessions } from '../../core/auth/index.js';
import { userWhere } from '../../core/authz/index.js';
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../core/errors/index.js';
import { businessDate } from '../../core/time/clock.js';
import { prisma } from '../../db/client.js';
import { withTransaction } from '../../db/transaction.js';
import { clientReadService } from '../catalog/clientReadService.js';
import {
  closeLine,
  currentLine,
  deleteLine,
  openLine,
  scheduledLine,
} from './transfers.repository.js';
import { MANAGER_ROLES, validateManager } from './transfers.service.js';
import * as repository from './userManagement.repository.js';

const error = (code, message, status = 422) => new AppError({ code, message, status });
const date = () => new Date(businessDate());

async function getUser(db, scope, id, at) {
  const user = await repository.visibleUser(db, scope, id, at);
  if (!user) throw new NotFoundError();
  return user;
}

export async function validateCommune(tx, wilayaId, communeId) {
  if (communeId != null && (await repository.findCommune(tx, communeId))?.wilayaId !== wilayaId) {
    throw error(ERROR_CODES.COMMUNE_NOT_IN_WILAYA, 'The commune must belong to the wilaya');
  }
}

function ensureProfileRole(role, profile) {
  if (profile && role !== 'animateur') {
    throw error(ERROR_CODES.BUSINESS_RULE_VIOLATION, 'Only Animateurs have an Animateur profile');
  }
}

async function password() {
  const temporaryPassword = randomBytes(12).toString('base64url');
  return { temporaryPassword, passwordHash: await hashPassword(temporaryPassword) };
}

async function write(work) {
  try {
    return await withTransaction(work, { isolationLevel: 'Serializable' });
  } catch (err) {
    if (
      err.details?.constraint === 'users_email_key' ||
      (err.code === 'P2002' && err.meta?.target?.includes('email'))
    ) {
      throw error(ERROR_CODES.EMAIL_TAKEN, 'The email is already in use', 409);
    }
    if (err.code === 'P2034' || err.cause?.originalCode === '40001') throw new ConflictError();
    throw err;
  }
}

function audit(tx, actor, action, id, before, after) {
  return auditService.record(tx, {
    actor,
    action,
    entityType: 'user',
    entityId: id,
    before,
    after,
  });
}

async function ensureActiveClient(tx, scope, clientId) {
  if (!(await clientReadService.isActiveClient(tx, scope, clientId))) {
    throw error(ERROR_CODES.CLIENT_INACTIVE, 'Choose an active client of the agency');
  }
}

/** Client portal accounts (Q-16): bound to an active client, no manager, no reporting line. */
function checkClientFields({ role, clientId }, managerId) {
  const issues = [];
  if (role === 'client' && !clientId) issues.push(['clientId', 'Required for client accounts']);
  if (role === 'client' && managerId) issues.push(['managerId', 'Client accounts have no manager']);
  if (role !== 'client' && clientId) issues.push(['clientId', 'Only client accounts have one']);
  if (issues.length) {
    throw new ValidationError(
      issues.map(([field, message]) => ({ path: 'body.' + field, message })),
    );
  }
}

async function createClientUser(scope, actor, data) {
  const { temporaryPassword, passwordHash } = await password();
  return write(async (tx) => {
    await ensureActiveClient(tx, scope, data.clientId);
    await validateCommune(tx, data.wilayaId, data.communeId);
    const user = await repository.createUser(tx, scope, { ...data, passwordHash });
    await audit(tx, actor, 'org.user_created', user.id, undefined, user);
    return { user, temporaryPassword };
  });
}

async function create(scope, actor, { profile, managerId, ...data }) {
  if (!Object.hasOwn(MANAGER_ROLES, data.role) && data.role !== 'client') {
    throw error(ERROR_CODES.ROLE_NOT_CREATABLE, 'This role cannot be created here');
  }
  checkClientFields(data, managerId);
  ensureProfileRole(data.role, profile);
  if (data.role === 'client') return createClientUser(scope, actor, data);
  const { temporaryPassword, passwordHash } = await password();
  const at = date();
  return write(async (tx) => {
    const manager = managerId
      ? await getUser(tx, scope, managerId, at)
      : data.role === 'general_manager' && (await repository.activeDirector(tx, scope));
    if (!manager) throw error(ERROR_CODES.INVALID_MANAGER_ROLE, 'A manager is required');
    await validateManager(tx, scope, data, manager, at);
    await validateCommune(tx, data.wilayaId, data.communeId);
    const user = await repository.createUser(tx, scope, { ...data, passwordHash });
    if (user.role === 'animateur') await repository.saveProfile(tx, scope, user.id, profile ?? {});
    await openLine(tx, scope, { userId: user.id, managerId: manager.id, validFrom: at });
    await audit(tx, actor, 'org.user_created', user.id, undefined, {
      ...user,
      profile,
      managerId: manager.id,
    });
    return { user, temporaryPassword };
  });
}

function update(scope, actor, id, { profile, ...data }) {
  return write(async (tx) => {
    const before = await getUser(tx, scope, id, date());
    ensureProfileRole(before.role, profile);
    await validateCommune(
      tx,
      data.wilayaId === undefined ? before.wilayaId : data.wilayaId,
      data.communeId === undefined ? before.communeId : data.communeId,
    );
    const beforeProfile = profile ? await repository.findProfile(tx, scope, id) : undefined;
    const user = await repository.updateUser(tx, scope, id, data);
    if (profile) await repository.saveProfile(tx, scope, id, profile);
    await audit(
      tx,
      actor,
      'org.user_updated',
      id,
      { ...before, profile: beforeProfile },
      { ...user, profile },
    );
    return user;
  });
}

function changeStatus(scope, actor, id, status) {
  const at = date();
  return write(async (tx) => {
    const before = await getUser(tx, scope, id, at);
    if (
      status !== 'active' &&
      before.role === 'director' &&
      before.status === 'active' &&
      (await repository.activeDirectorCount(tx, scope)) === 1
    ) {
      throw error(ERROR_CODES.LAST_ACTIVE_DIRECTOR, 'The agency needs an active director');
    }
    if (actor.id === id && status !== 'active') {
      throw error(
        ERROR_CODES.CANNOT_CHANGE_OWN_STATUS,
        'You cannot suspend or mark your own account left',
      );
    }
    if (status === 'active' && before.role === 'client') {
      await ensureActiveClient(tx, scope, before.clientId);
    }
    if (status === 'left') {
      const future = await scheduledLine(tx, scope, id, at);
      if (future) await deleteLine(tx, scope, future.id);
      const line = await currentLine(tx, scope, id, at);
      if (line) await closeLine(tx, scope, line.id, at);
    }
    if (status !== 'active') await revokeAllSessions(tx, id);
    const after = await repository.updateUser(tx, scope, id, { status });
    await audit(tx, actor, 'org.user_status_changed', id, { status: before.status }, { status });
    return after;
  });
}

async function resetPassword(scope, actor, id) {
  const { temporaryPassword, passwordHash } = await password();
  return write(async (tx) => {
    await getUser(tx, scope, id, date());
    await repository.updateUser(tx, scope, id, { passwordHash, mustChangePassword: true });
    await revokeAllSessions(tx, id);
    await audit(tx, actor, 'org.user_password_reset', id, undefined, { mustChangePassword: true });
    return { temporaryPassword };
  });
}

async function detail(scope, id) {
  const at = date();
  const user = await getUser(prisma, scope, id, at);
  const visibility = await userWhere(scope, { at, reportingOnly: true });
  const [profile, reportingLines] = await Promise.all([
    repository.findProfile(prisma, scope, id),
    repository.reportingLines(scope, id, visibility.id?.in),
  ]);
  const active = reportingLines.find(
    ({ validFrom, validTo }) => validFrom <= at && (!validTo || validTo > at),
  );
  const manager = active?.manager;
  return {
    user,
    profile,
    currentManager: manager
      ? { id: manager.id, fullName: manager.fullName, role: manager.role }
      : null,
    reportingLines: reportingLines.map((line) => ({
      ...line,
      validFrom: line.validFrom.toISOString().slice(0, 10),
      validTo: line.validTo?.toISOString().slice(0, 10) ?? null,
    })),
  };
}

/**
 * Suspends every active portal account of a client and revokes their sessions, inside the caller's
 * transaction (the catalog module calls it when the client is soft-deleted).
 */
async function suspendClientUsers(tx, scope, actor, clientId) {
  const users = await repository.activeClientUsers(tx, scope, clientId);
  for (const { id } of users) {
    await revokeAllSessions(tx, id);
    await repository.updateUser(tx, scope, id, { status: 'suspended' });
    await audit(
      tx,
      actor,
      'org.user_status_changed',
      id,
      { status: 'active' },
      {
        status: 'suspended',
        reason: 'client_deleted',
      },
    );
  }
  return users.length;
}

export const userManagementService = Object.freeze({
  suspendClientUsers,
  create,
  update,
  changeStatus,
  resetPassword,
  detail,
});
