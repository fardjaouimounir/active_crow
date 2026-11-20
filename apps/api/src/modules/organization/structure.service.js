import { ERROR_CODES } from '@fieldflow/shared';
import { auditService } from '../../core/audit/index.js';
import { AppError, ConflictError, NotFoundError } from '../../core/errors/index.js';
import { clock } from '../../core/time/clock.js';
import { prisma } from '../../db/client.js';
import { withTransaction } from '../../db/transaction.js';
import { validateCommune } from './userManagement.service.js';
import * as repository from './structure.repository.js';

const error = (code, message, status = 422) => new AppError({ code, message, status });
const versionConflict = () =>
  error(ERROR_CODES.VERSION_CONFLICT, 'The point of sale has changed. Reload and try again', 409);
const constraints = {
  region_wilayas_agency_id_wilaya_id_key: [
    ERROR_CODES.WILAYA_ALREADY_IN_REGION,
    'A wilaya already belongs to a region',
  ],
  points_of_sale_agency_id_code_key: [
    ERROR_CODES.POS_CODE_TAKEN,
    'This point-of-sale code is already in use',
  ],
};

async function write(work, retryConflict = () => new ConflictError()) {
  try {
    return await withTransaction(work, { isolationLevel: 'Serializable' });
  } catch (err) {
    const conflict = constraints[err.details?.constraint];
    if (conflict) throw error(...conflict, 409);
    if (
      err.code === 'P2034' ||
      err.cause?.originalCode === '40001' ||
      err.meta?.driverAdapterError?.cause?.originalCode === '40001'
    ) {
      throw retryConflict();
    }
    throw err;
  }
}

function audit(tx, actor, entityType, action, before, after) {
  return auditService.record(tx, {
    actor,
    action: 'org.' + entityType + '_' + action,
    entityType,
    entityId: (after ?? before).id,
    before,
    after,
  });
}

async function required(record) {
  const data = await record;
  if (!data) throw new NotFoundError();
  return data;
}

function createRegion(scope, actor, data) {
  return write(async (tx) => {
    const result = await repository.createRegion(tx, scope, data);
    await audit(tx, actor, 'region', 'created', undefined, result);
    return result;
  });
}

function updateRegion(scope, actor, id, data, action) {
  return write(async (tx) => {
    const before = await required(repository.region(tx, scope, id));
    if (action === 'deleted' && before.wilayas.length) {
      throw error(ERROR_CODES.REGION_NOT_EMPTY, 'Unassign the wilayas before deleting the region');
    }
    if (action === 'wilayas_changed') await repository.setWilayas(tx, scope, id, data.wilayaIds);
    else
      await repository.updateRegion(
        tx,
        scope,
        id,
        action === 'deleted' ? { deletedAt: clock.now() } : data,
      );
    const after = action === 'deleted' ? undefined : await repository.region(tx, scope, id);
    await audit(tx, actor, 'region', action, before, after);
    return after;
  });
}

function createPoint(scope, actor, data) {
  return write(async (tx) => {
    await validateCommune(tx, data.wilayaId, data.communeId);
    const after = await repository.createPoint(tx, scope, data);
    await audit(tx, actor, 'point_of_sale', 'created', undefined, after);
    return after;
  });
}

function updatePoint(scope, actor, id, { version, ...data }) {
  return write(async (tx) => {
    const before = await required(repository.point(tx, scope, id));
    if (version !== before.version) throw versionConflict();
    const wilayaId = data.wilayaId ?? before.wilayaId;
    const communeId = data.communeId === undefined ? before.communeId : data.communeId;
    await validateCommune(tx, wilayaId, communeId);
    const { count } = await repository.updatePoint(tx, scope, id, version, data);
    if (!count) throw versionConflict();
    const after = await repository.point(tx, scope, id);
    await audit(tx, actor, 'point_of_sale', 'updated', before, after);
    return after;
  }, versionConflict);
}

function deletePoint(scope, actor, id) {
  return write(async (tx) => {
    const before = await required(repository.point(tx, scope, id));
    if (await repository.linkedToActiveCampaign(tx, scope, id)) {
      throw error(
        ERROR_CODES.POS_IN_ACTIVE_CAMPAIGN,
        'This point of sale belongs to an active campaign',
      );
    }
    await repository.updatePoint(tx, scope, id, before.version, { deletedAt: clock.now() });
    await audit(tx, actor, 'point_of_sale', 'deleted', before);
  });
}

export const structureService = Object.freeze({
  listRegions: repository.listRegions,
  createRegion,
  updateRegion,
  listPoints: repository.listPoints,
  point: (scope, id) => required(repository.point(prisma, scope, id)),
  createPoint,
  updatePoint,
  deletePoint,
});
