import { can, now, today } from '@fieldflow/shared';
import { auditService } from '../../core/audit/index.js';
import { AppError, ForbiddenError, NotFoundError } from '../../core/errors/index.js';
import { events } from '../../core/events/index.js';
import { prisma } from '../../db/client.js';
import { withTransaction } from '../../db/transaction.js';
import { assignmentReadService } from '../assignments/assignmentReadService.js';
import { fileService } from '../files/files.service.js';
import { canReadIssue } from './issues.policies.js';
import * as repo from './issues.repository.js';

const fail = (code, status = 422) =>
  new AppError({ code, status, message: code.toLowerCase().replaceAll('_', ' ') });
const transition = {
  start: { open: 'in_progress' },
  resolve: { in_progress: 'resolved' },
  reopen: { resolved: 'open' },
  close: { open: 'closed', in_progress: 'closed', resolved: 'closed' },
};

function serialize(issue) {
  const { campaign, ...row } = issue;
  return { ...row, campaign: { id: campaign.id, name: campaign.name, status: campaign.status } };
}
async function required(db, actor, id) {
  const row = await repo.getIssue(db, actor, id);
  if (!row || !canReadIssue(actor, row)) throw new NotFoundError();
  return row;
}
async function list(actor, filters) {
  const rows = (await repo.listIssues(prisma, actor, filters)).filter((row) =>
    canReadIssue(actor, row),
  );
  const { page, pageSize } = filters;
  const counts = Object.fromEntries(
    ['open', 'in_progress', 'resolved', 'closed'].map((status) => [
      status,
      rows.filter((row) => row.status === status).length,
    ]),
  );
  return {
    data: rows.slice((page - 1) * pageSize, page * pageSize).map(serialize),
    meta: { page, pageSize, total: rows.length, counts },
  };
}
async function detail(actor, id) {
  return serialize(await required(prisma, actor, id));
}

function notify(tx, actor, action, issueId, snapshot) {
  events.emit(tx, 'issue.' + action, {
    agencyId: actor.agencyId,
    actorId: actor.id,
    issueId,
    ...snapshot,
  });
}
function audit(tx, actor, action, entityType, entityId, before, after) {
  return auditService.record(tx, {
    actor,
    action: 'issue.' + action,
    entityType,
    entityId,
    before,
    after,
  });
}

async function attach(tx, actor, issueId, files, commentId) {
  if (files.length > 3) throw fail('TOO_MANY_ATTACHMENTS');
  for (const file of files) {
    const saved = await fileService.store(tx, {
      actor,
      kind: 'issue_attachment',
      buffer: file.buffer,
      originalName: file.originalname,
    });
    await tx.issueAttachment.create({
      data: { agencyId: actor.agencyId, issueId, fileId: saved.id, commentId },
    });
  }
}

function create(actor, input, files, transaction = fileService.transaction) {
  return transaction(async (tx) => {
    const { agencyId } = actor;
    await tx.$queryRaw`SELECT id FROM campaigns WHERE id = ${input.campaignId}::uuid AND agency_id = ${agencyId}::uuid FOR SHARE`;
    const campaign = await repo.campaignForIssue(tx, actor, input.campaignId);
    if (!campaign) throw new NotFoundError();
    const point = campaign.pointsOfSale.find(
      ({ pointOfSale }) => pointOfSale.id === input.pointOfSaleId && !pointOfSale.deletedAt,
    )?.pointOfSale;
    if (actor.role === 'animateur') {
      const match =
        point &&
        (await assignmentReadService.hasApprovedAssignmentOnDay(
          tx,
          { agencyId, userId: actor.id },
          { campaignId: campaign.id, pointOfSaleId: point.id, day: today() },
        ));
      if (!match) throw fail('NOT_ASSIGNED_HERE');
    } else if (['regional_manager', 'supervisor'].includes(actor.role)) {
      const local = campaign.wilayas.some(
        ({ wilayaId, staff }) =>
          (!input.pointOfSaleId || point?.wilayaId === wilayaId) &&
          staff.some(({ userId, role }) => userId === actor.id && role === actor.role),
      );
      if (!local) throw new NotFoundError();
    }
    if (!['assigned', 'active', 'suspended'].includes(campaign.status))
      throw fail('CAMPAIGN_NOT_ACCEPTING_ISSUES');
    if (input.pointOfSaleId && !point) throw fail('POS_NOT_IN_CAMPAIGN');
    if (
      input.stockItemId &&
      !(await tx.stockItem.findFirst({
        where: { id: input.stockItemId, agencyId, clientId: campaign.clientId, deletedAt: null },
        select: { id: true },
      }))
    )
      throw new NotFoundError();
    const row = await createInTransaction(tx, actor, input, files);
    return serialize(await required(tx, actor, row.id));
  });
}

// The visit service supplies the campaign, point and visit from its scoped, validated visit.
async function createInTransaction(tx, actor, input, files) {
  const row = await tx.issue.create({
    data: { ...input, agencyId: actor.agencyId, reportedById: actor.id },
  });
  if (files?.length) await attach(tx, actor, row.id, files);
  await audit(tx, actor, 'created', 'issue', row.id, undefined, row);
  notify(tx, actor, 'created', row.id);
  return row;
}

function change(actor, id, action, input) {
  return withTransaction(async (tx) => {
    const issue = await required(tx, actor, id);
    if ((await repo.lockCampaignStatus(tx, actor.agencyId, issue.campaignId)) === 'closed')
      throw fail('CAMPAIGN_NOT_ACCEPTING_ISSUES');
    if (
      !can(actor.role, 'issue.manage') &&
      !(action === 'reopen' && issue.reportedById === actor.id)
    )
      throw new ForbiddenError();
    if (issue.version !== input.version) throw fail('VERSION_CONFLICT', 409);
    let data;
    if (action === 'assign') {
      const user = await tx.user.findFirst({
        where: {
          id: input.assigneeId,
          agencyId: actor.agencyId,
          status: 'active',
          role: { in: ['director', 'general_manager', 'regional_manager', 'supervisor'] },
        },
        select: { id: true, agencyId: true, role: true },
      });
      if (!user || !canReadIssue(user, issue)) throw fail('ASSIGNEE_NOT_ELIGIBLE');
      data = { assignedToId: user.id };
    } else {
      const status = transition[action]?.[issue.status];
      if (!status) throw fail('INVALID_ISSUE_TRANSITION');
      if (
        (action === 'resolve' || (action === 'close' && issue.status !== 'resolved')) &&
        !input.resolutionNote
      )
        throw fail('RESOLUTION_NOTE_REQUIRED');
      data = { status };
      if (action === 'resolve' || (action === 'close' && issue.status !== 'resolved'))
        Object.assign(data, {
          resolvedAt: now(),
          resolvedById: actor.id,
          resolutionNote: input.resolutionNote,
        });
      if (action === 'reopen')
        Object.assign(data, { resolvedAt: null, resolvedById: null, resolutionNote: null });
    }
    const changed = await tx.issue.updateMany({
      where: { id, agencyId: actor.agencyId, version: input.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (!changed.count) throw fail('VERSION_CONFLICT', 409);
    await audit(
      tx,
      actor,
      action,
      'issue',
      id,
      { status: issue.status, assignedToId: issue.assignedToId },
      data,
    );
    notify(tx, actor, action === 'assign' ? 'assigned' : 'status_changed', id, {
      assigneeId: action === 'assign' ? data.assignedToId : issue.assignedToId,
    });
    return serialize(await required(tx, actor, id));
  });
}
async function comments(actor, id) {
  return repo.comments(prisma, await required(prisma, actor, id));
}
function comment(actor, id, input, files) {
  return fileService.transaction(async (tx) => {
    const issue = await required(tx, actor, id);
    if ((await repo.lockCampaignStatus(tx, actor.agencyId, issue.campaignId)) === 'closed')
      throw fail('CAMPAIGN_NOT_ACCEPTING_ISSUES');
    const row = await tx.issueComment.create({
      data: { issueId: id, agencyId: actor.agencyId, authorId: actor.id, body: input.body },
    });
    await attach(tx, actor, id, files, row.id);
    await audit(tx, actor, 'commented', 'issue_comment', row.id, undefined, { issueId: id });
    notify(tx, actor, 'commented', id, {
      assigneeId: issue.assignedToId,
      commentAt: row.createdAt.toISOString(),
    });
    return (await repo.comments(tx, issue)).find(({ id }) => id === row.id);
  });
}

async function openShortage(tx, actor, assignment, stockItemId) {
  const { agencyId } = actor;
  for (;;) {
    const [inserted] = await tx.$queryRaw`
      INSERT INTO issues (agency_id, campaign_id, assignment_id, point_of_sale_id, stock_item_id,
        category, title, reported_by, assigned_to)
      VALUES (${agencyId}::uuid, ${assignment.campaignId}::uuid, ${assignment.id}::uuid,
        ${assignment.pointOfSaleId}::uuid, ${stockItemId}::uuid,
        'stock_shortage', 'Gift stock shortage', ${actor.id}::uuid, ${assignment.supervisorId}::uuid)
      ON CONFLICT (assignment_id, stock_item_id)
      WHERE category = 'stock_shortage' AND status IN ('open','in_progress') AND assignment_id IS NOT NULL
      DO NOTHING RETURNING id`;
    if (inserted) {
      await audit(tx, actor, 'created', 'issue', inserted.id, undefined, {
        assignmentId: assignment.id,
        stockItemId,
      });
      notify(tx, actor, 'created', inserted.id, { assigneeId: assignment.supervisorId });
      return inserted.id;
    }
    const [existing] = await tx.$queryRaw`
      SELECT id FROM issues WHERE agency_id = ${agencyId}::uuid
        AND assignment_id = ${assignment.id}::uuid AND stock_item_id = ${stockItemId}::uuid
        AND category = 'stock_shortage' AND status IN ('open','in_progress') FOR UPDATE`;
    if (existing) return existing.id;
  }
}

async function recordCompletedDelivery(tx, actor, issueId) {
  const [issue] = await tx.$queryRaw`
    SELECT id, assigned_to AS "assignedToId" FROM issues
    WHERE id = ${issueId}::uuid AND agency_id = ${actor.agencyId}::uuid FOR UPDATE`;
  if (
    !issue ||
    (await tx.giftEntitlement.count({
      where: { agencyId: actor.agencyId, shortageIssueId: issueId, status: 'undelivered' },
    }))
  )
    return;
  const row = await tx.issueComment.create({
    data: {
      issueId,
      agencyId: actor.agencyId,
      authorId: actor.id,
      body: 'All gifts linked to this shortage have now been delivered.',
    },
  });
  await audit(tx, actor, 'commented', 'issue_comment', row.id, undefined, { issueId });
  notify(tx, actor, 'commented', issueId, {
    assigneeId: issue.assignedToId,
    commentAt: row.createdAt.toISOString(),
  });
}

export const issueService = {
  list,
  detail,
  create,
  createInTransaction,
  openShortage,
  recordCompletedDelivery,
  change,
  comments,
  comment,
};
