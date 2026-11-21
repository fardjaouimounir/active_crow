// Campaigns core (M3, FR-030 creation, FR-031 coverage, FR-032 documents). Every write locks the
// campaign row and asks the central edit policy (editPolicy.js) whether its area is editable in the
// current status.
import { ERROR_CODES } from '@fieldflow/shared';
import { auditService } from '../../core/audit/index.js';
import { AppError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import { businessDate } from '../../core/time/clock.js';
import { prisma } from '../../db/client.js';
import { withTransaction } from '../../db/transaction.js';
import { assignmentReadService } from '../assignments/assignmentReadService.js';
import { clientReadService } from '../catalog/clientReadService.js';
import { fileService } from '../files/files.service.js';
import { organizationReadService } from '../organization/organizationReadService.js';
import * as repository from './campaigns.repository.js';
import { assertEditable } from './editPolicy.js';
import * as team from './team.repository.js';

const rule = (code, message, details) => new AppError({ status: 422, code, message, details });

/** What a client-role user may see of a campaign: no budget, approver, staff or coverage. */
const CLIENT_FIELDS = ['id', 'code', 'name', 'description', 'status', 'startDate', 'endDate'];
const forScope = (scope, campaign) =>
  scope.level === 'client'
    ? Object.fromEntries([...CLIENT_FIELDS, 'client'].map((key) => [key, campaign[key] ?? null]))
    : campaign;

async function required(record) {
  const row = await record;
  if (!row) throw new NotFoundError();
  return row;
}

const visible = (db, scope, id) => required(repository.findCampaign(db, scope, id));

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

/** Locks the campaign row for the rest of the transaction. */
async function lock(tx, scope, id) {
  return required(repository.lockCampaign(tx, scope, id));
}

/** Locks the campaign and refuses unless `area` is editable in its status. */
async function editable(tx, scope, id, area, change) {
  const campaign = await lock(tx, scope, id);
  assertEditable(campaign, area, change);
  return campaign;
}

const startInPast = () =>
  rule(ERROR_CODES.CAMPAIGN_START_IN_PAST, 'The start date cannot be in the past');

async function list(scope, query) {
  const result = await repository.listCampaigns(scope, query);
  return { ...result, data: result.data.map((row) => forScope(scope, row)) };
}

async function detail(scope, id) {
  const campaign = await visible(prisma, scope, id);
  if (scope.level === 'client') return forScope(scope, campaign);
  // How many Animateurs each supervisor has chosen so far (a number only, never the names).
  const counts = await team.teamCounts(prisma, id);
  return {
    ...campaign,
    wilayas: campaign.wilayas.map((wilaya) => ({
      ...wilaya,
      staff: wilaya.staff.map((member) =>
        member.role === 'supervisor'
          ? { ...member, teamCount: counts.get(member.user.id) ?? 0 }
          : member,
      ),
    })),
  };
}

async function create(scope, actor, data) {
  if (data.startDate < businessDate()) throw startInPast();
  return withTransaction(async (tx) => {
    if (!(await clientReadService.isActiveClient(tx, scope, data.clientId))) {
      throw rule(ERROR_CODES.CLIENT_INACTIVE, 'Choose an active client of the agency');
    }
    const campaign = await repository.insertDraftCampaign(tx, scope, data, actor.id);
    await audit(tx, actor, 'created', campaign.id, undefined, campaign);
    return campaign;
  });
}

const AREA_OF_FIELD = {
  name: 'details',
  description: 'details',
  budgetAmount: 'details',
  startDate: 'startDate',
  endDate: 'endDate',
  assignmentApproverRole: 'approver',
};

function update(scope, actor, id, { version, ...data }) {
  return withTransaction(async (tx) => {
    const locked = await lock(tx, scope, id);
    if (locked.version !== version) {
      throw new AppError({
        status: 409,
        code: ERROR_CODES.VERSION_CONFLICT,
        message: 'The campaign has changed. Reload and try again',
      });
    }
    const before = await visible(tx, scope, id);
    const today = businessDate();
    // A field the form sends back unchanged is not an edit of that field.
    for (const [field, value] of Object.entries(data)) {
      if (value === before[field]) continue;
      assertEditable(
        before,
        AREA_OF_FIELD[field],
        field === 'endDate' ? { endDate: value, today } : undefined,
      );
    }
    const startDate = data.startDate ?? before.startDate;
    const endDate = data.endDate ?? before.endDate;
    if (endDate < startDate) {
      throw new ValidationError([
        { path: 'body.endDate', message: 'The end date must be on or after the start date' },
      ]);
    }
    if (data.startDate && data.startDate !== before.startDate && startDate < today) {
      throw startInPast();
    }
    await repository.updateCampaign(tx, scope, id, version, data);
    const after = await visible(tx, scope, id);
    await audit(tx, actor, 'updated', id, before, after);
    return after;
  });
}

function setWilayas(scope, actor, id, { wilayas }) {
  return withTransaction(async (tx) => {
    await editable(tx, scope, id, 'coverage');
    const ids = wilayas.map((row) => row.wilayaId);
    const known = await repository.knownWilayaIds(tx, ids);
    const unknown = ids.filter((wilayaId) => !known.includes(wilayaId));
    if (unknown.length) {
      throw new ValidationError([{ path: 'body.wilayas', message: 'Unknown wilaya ' + unknown }]);
    }
    const before = await repository.campaignWilayas(tx, id);
    const removed = before.map((row) => row.wilayaId).filter((wilayaId) => !ids.includes(wilayaId));
    const usage = await repository.wilayaUsage(tx, id, removed);
    if (usage.length) {
      throw rule(
        ERROR_CODES.WILAYA_IN_USE,
        'Remove the staff and points of sale of a wilaya before removing it',
        { wilayas: usage },
      );
    }
    await repository.replaceWilayas(tx, scope, id, wilayas);
    await audit(tx, actor, 'wilayas_changed', id, { wilayas: before }, { wilayas });
    return visible(tx, scope, id);
  });
}

function addStaff(scope, actor, id, { userId, wilayaId, role, requiredAnimateurs = 0 }) {
  return withTransaction(async (tx) => {
    await editable(tx, scope, id, 'coverage');
    const wilayas = await repository.campaignWilayas(tx, id);
    if (!wilayas.some((row) => row.wilayaId === wilayaId)) {
      throw rule(ERROR_CODES.WILAYA_NOT_IN_CAMPAIGN, 'Add the wilaya to the campaign first');
    }
    const user = await required(organizationReadService.findUser(tx, scope, userId));
    if (user.role !== role) {
      throw rule(ERROR_CODES.STAFF_ROLE_MISMATCH, 'The staff role must match the account role', {
        accountRole: user.role,
      });
    }
    if (user.status !== 'active') {
      throw rule(ERROR_CODES.USER_INACTIVE, 'The user is not active', { status: user.status });
    }
    if (role === 'regional_manager' && (await repository.regionalOfWilaya(tx, id, wilayaId))) {
      throw rule(
        ERROR_CODES.WILAYA_ALREADY_HAS_REGIONAL,
        'This wilaya already has a regional manager in the campaign',
      );
    }
    if (role !== 'supervisor' && requiredAnimateurs > 0) {
      throw rule(
        ERROR_CODES.QUOTA_ONLY_FOR_SUPERVISORS,
        'Only supervisors have an Animateur quota',
      );
    }
    const staff = await repository.createStaff(tx, scope, {
      campaignId: id,
      wilayaId,
      userId,
      role,
      requiredAnimateurs,
    });
    await team.syncWilayaNeed(tx, id, wilayaId);
    await audit(tx, actor, 'staff_added', id, undefined, {
      staffId: staff.id,
      userId,
      wilayaId,
      role,
      requiredAnimateurs,
    });
    return staff;
  });
}

function removeStaff(scope, actor, id, staffId) {
  return withTransaction(async (tx) => {
    await editable(tx, scope, id, 'coverage');
    const staff = await required(repository.findStaff(tx, id, staffId));
    const assignments = await assignmentReadService.countActiveForSupervisor(tx, id, staff.userId);
    if (assignments > 0) {
      throw rule(
        ERROR_CODES.STAFF_HAS_ASSIGNMENTS,
        'This person supervises proposed or approved assignments in the campaign',
        { assignments },
      );
    }
    if (staff.role === 'supervisor') {
      const others = (await team.supervisorStaff(tx, id, staff.userId)).filter(
        (row) => row.id !== staffId,
      );
      const members = await team.countTeam(tx, id, staff.userId);
      if (members > 0 && others.length === 0) {
        throw rule(
          ERROR_CODES.STAFF_HAS_TEAM,
          'This supervisor has Animateurs in the campaign: remove them first',
          { members },
        );
      }
    }
    await repository.deleteStaff(tx, staffId);
    await team.syncWilayaNeed(tx, id, staff.wilayaId);
    await audit(tx, actor, 'staff_removed', id, staff);
  });
}

function setPointsOfSale(scope, actor, id, { pointOfSaleIds }) {
  return withTransaction(async (tx) => {
    await editable(tx, scope, id, 'coverage');
    const points = await organizationReadService.findPointsOfSale(tx, scope, pointOfSaleIds);
    const wilayas = await repository.campaignWilayas(tx, id);
    const covered = new Set(wilayas.map((row) => row.wilayaId));
    const valid = new Set(points.filter((p) => covered.has(p.wilayaId)).map((p) => p.id));
    const invalid = pointOfSaleIds.filter((pointId) => !valid.has(pointId));
    if (invalid.length) {
      throw rule(
        ERROR_CODES.POS_OUTSIDE_CAMPAIGN_WILAYAS,
        'Every point of sale must be active and in one of the campaign wilayas',
        { pointOfSaleIds: invalid },
      );
    }
    const before = await repository.linkedPointOfSaleIds(tx, id);
    const removed = before.filter((pointId) => !pointOfSaleIds.includes(pointId));
    const busy = await assignmentReadService.pointsOfSaleWithActiveAssignments(tx, id, removed);
    if (busy.length) {
      throw rule(
        ERROR_CODES.POS_HAS_ASSIGNMENTS,
        'These points of sale have proposed or approved assignments',
        { pointOfSaleIds: busy },
      );
    }
    await repository.replacePointsOfSale(tx, scope, id, pointOfSaleIds);
    await audit(
      tx,
      actor,
      'points_of_sale_changed',
      id,
      { pointOfSaleIds: before },
      { pointOfSaleIds },
    );
    return visible(tx, scope, id);
  });
}

function setProducts(scope, actor, id, { productIds }) {
  return withTransaction(async (tx) => {
    const campaign = await lock(tx, scope, id);
    const current = await repository.linkedProductIds(tx, id);
    assertEditable(campaign, 'products', {
      removing: current.some((productId) => !productIds.includes(productId)),
    });
    const found = await clientReadService.activeProductIds(
      tx,
      scope,
      campaign.clientId,
      productIds,
    );
    const invalid = productIds.filter((productId) => !found.includes(productId));
    if (invalid.length) {
      throw rule(
        ERROR_CODES.PRODUCT_NOT_OF_CLIENT,
        "Every product must be an active product of the campaign's client",
        { productIds: invalid },
      );
    }
    await repository.replaceProducts(tx, scope, id, productIds);
    await audit(tx, actor, 'products_changed', id, { productIds: current }, { productIds });
    return visible(tx, scope, id);
  });
}

async function documents(scope, id) {
  await visible(prisma, scope, id);
  const client = scope.level === 'client';
  const rows = await repository.listDocuments(prisma, id, { clientVisibleOnly: client });
  return client ? rows.map(({ uploadedBy: _uploadedBy, ...row }) => row) : rows;
}

/** FR-032: the file pipeline stores the bytes; the link and its label belong to the campaign. */
function addDocument(scope, actor, id, { buffer, originalName, label }) {
  return fileService.transaction(async (tx) => {
    await editable(tx, scope, id, 'documents');
    const file = await fileService.store(tx, {
      actor,
      kind: 'campaign_document',
      buffer,
      originalName,
    });
    const document = await repository.createDocument(tx, scope, {
      campaignId: id,
      fileId: file.id,
      label,
    });
    await audit(tx, actor, 'document_added', id, undefined, { fileId: file.id, label });
    return document;
  });
}

function relabelDocument(scope, actor, id, fileId, { label }) {
  return withTransaction(async (tx) => {
    await editable(tx, scope, id, 'documents');
    const before = await required(repository.findDocument(tx, id, fileId));
    const after = await repository.updateDocument(tx, id, fileId, label);
    await audit(
      tx,
      actor,
      'document_relabelled',
      id,
      { fileId, label: before.label },
      {
        fileId,
        label,
      },
    );
    return after;
  });
}

/** Unlinks the document; the `files` row stays for history (BR-03 spirit). */
function removeDocument(scope, actor, id, fileId) {
  return withTransaction(async (tx) => {
    await editable(tx, scope, id, 'documents');
    const before = await required(repository.findDocument(tx, id, fileId));
    await repository.deleteDocument(tx, id, fileId);
    await audit(tx, actor, 'document_removed', id, { fileId, label: before.label });
  });
}

async function statusHistory(scope, id) {
  await visible(prisma, scope, id);
  return repository.statusHistory(prisma, id);
}

export const campaignsService = Object.freeze({
  list,
  detail,
  create,
  update,
  setWilayas,
  addStaff,
  removeStaff,
  setPointsOfSale,
  setProducts,
  documents,
  addDocument,
  relabelDocument,
  removeDocument,
  statusHistory,
});
