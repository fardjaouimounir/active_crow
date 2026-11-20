import { ERROR_CODES } from '@fieldflow/shared';
import { auditService } from '../../core/audit/index.js';
import { AppError, ConflictError, NotFoundError } from '../../core/errors/index.js';
import { businessDate } from '../../core/time/clock.js';
import { withTransaction } from '../../db/transaction.js';
import { inventoryReadService } from '../inventory/inventoryReadService.js';
import { descendantIds } from './hierarchy.repository.js';
import * as repository from './transfers.repository.js';

export const MANAGER_ROLES = Object.freeze({
  animateur: Object.freeze(['supervisor']),
  supervisor: Object.freeze(['regional_manager']),
  regional_manager: Object.freeze(['general_manager', 'director']),
  general_manager: Object.freeze(['director']),
});

const invalid = (code, message, details) => new AppError({ status: 422, code, message, details });
const scheduled = () =>
  new AppError({
    status: 409,
    code: ERROR_CODES.TRANSFER_ALREADY_SCHEDULED,
    message: 'A transfer is already scheduled or another transfer was saved concurrently',
  });

async function transferTransaction(work) {
  try {
    return await withTransaction(work, { isolationLevel: 'Serializable' });
  } catch (err) {
    if (
      err.code === 'P2034' ||
      err.cause?.originalCode === '40001' ||
      err.meta?.driverAdapterError?.cause?.originalCode === '40001' ||
      err.details?.constraint === 'reporting_lines_no_overlap'
    )
      throw scheduled();
    throw err;
  }
}

function transferDate(effectiveDate, at) {
  const date = new Date(effectiveDate);
  const lastDate = new Date(at);
  lastDate.setUTCDate(lastDate.getUTCDate() + 90);
  if (date < at || date > lastDate) {
    throw invalid(
      ERROR_CODES.TRANSFER_DATE_INVALID,
      'Transfer date must be within the next 90 days',
    );
  }
  return date;
}

async function visibleUser(tx, scope, id, at) {
  const user = await repository.findTransferUser(tx, scope, id, at);
  if (!user) throw new NotFoundError();
  return user;
}

export async function validateManager(tx, scope, user, manager, validFrom) {
  if (user.id === manager.id) {
    throw invalid(ERROR_CODES.MANAGER_CYCLE, 'A user cannot manage themselves');
  }
  if (!MANAGER_ROLES[user.role]?.includes(manager.role) || manager.status !== 'active') {
    throw invalid(
      ERROR_CODES.INVALID_MANAGER_ROLE,
      'Choose an active manager with an eligible role',
    );
  }
  if (user.id) {
    const ids = await descendantIds(
      tx,
      { agencyId: scope.agencyId, userId: user.id },
      validFrom.toISOString().slice(0, 10),
    );
    if (ids.includes(manager.id))
      throw invalid(ERROR_CODES.MANAGER_CYCLE, 'The manager is a descendant of the user');
  }
}

async function move(tx, scope, actor, user, manager, { validFrom, reason, at }) {
  if (await repository.scheduledLine(tx, scope, user.id, at)) throw scheduled();
  const line = await repository.currentLine(tx, scope, user.id, at);
  if (!line) throw new NotFoundError('No current reporting line');
  await validateManager(tx, scope, user, manager, validFrom);
  if (line.managerId === manager.id)
    throw new ConflictError('The user already reports to this manager');
  const { hasHoldings, campaigns } = await inventoryReadService.hasOpenHoldings(tx, user.id);
  if (hasHoldings) {
    throw invalid(
      ERROR_CODES.HOLDER_HAS_STOCK,
      'Settle the holder stock before transferring the user',
      { campaigns },
    );
  }
  await repository.closeLine(tx, scope, line.id, validFrom);
  const next = await repository.openLine(tx, scope, {
    userId: user.id,
    managerId: manager.id,
    validFrom,
    reason,
  });
  await auditService.record(tx, {
    actor,
    action: 'org.user_transferred',
    entityType: 'user',
    entityId: user.id,
    before: { managerId: line.managerId },
    after: { managerId: manager.id, effectiveDate: validFrom.toISOString().slice(0, 10) },
  });
  return { ...next, validFrom: next.validFrom.toISOString().slice(0, 10) };
}

function create(scope, actor, id, { newManagerId, effectiveDate, reason }, team = false) {
  const at = new Date(businessDate());
  const validFrom = transferDate(effectiveDate, at);
  return transferTransaction(async (tx) => {
    const user = await visibleUser(tx, scope, id, at);
    const manager = await visibleUser(tx, scope, newManagerId, at);
    const options = { validFrom, reason, at };
    if (!team) return move(tx, scope, actor, user, manager, options);
    const result = [];
    for (const { userId } of await repository.teamLines(tx, scope, id, at)) {
      const member = await visibleUser(tx, scope, userId, at);
      result.push(await move(tx, scope, actor, member, manager, options));
    }
    return result;
  });
}

function cancel(scope, actor, id) {
  const at = new Date(businessDate());
  return transferTransaction(async (tx) => {
    await visibleUser(tx, scope, id, at);
    const future = await repository.scheduledLine(tx, scope, id, at);
    if (!future) throw new NotFoundError('No scheduled transfer');
    await visibleUser(tx, scope, future.managerId, at);
    const previous = await repository.currentLine(tx, scope, id, at);
    if (!previous || previous.validTo?.getTime() !== future.validFrom.getTime()) {
      throw new NotFoundError('No previous reporting line');
    }
    await repository.deleteLine(tx, scope, future.id);
    await repository.closeLine(tx, scope, previous.id, null);
    await auditService.record(tx, {
      actor,
      action: 'org.user_transfer_cancelled',
      entityType: 'user',
      entityId: id,
      before: { managerId: future.managerId, effectiveDate: future.validFrom },
      after: { managerId: previous.managerId },
    });
  });
}

export const transfersService = Object.freeze({ create, cancel });
