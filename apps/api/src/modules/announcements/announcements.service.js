import { randomUUID } from 'node:crypto';
import { now } from '@fieldflow/shared';
import { auditService } from '../../core/audit/index.js';
import { campaignWhere, ScopeService, scoped, userWhere } from '../../core/authz/index.js';
import { AppError, NotFoundError } from '../../core/errors/index.js';
import { events } from '../../core/events/index.js';
import { prisma } from '../../db/client.js';
import { withTransaction } from '../../db/transaction.js';
import { notificationService } from '../notifications/notifications.service.js';

const type = 'announcement.published';
const fail = (code) =>
  new AppError({ code, status: 422, message: code.toLowerCase().replaceAll('_', ' ') });

async function audience(db, actor, { campaignId, wilayaId, targetRoles }) {
  const { agencyId, id, role } = actor;
  if (role === 'supervisor' && targetRoles.some((value) => value !== 'animateur'))
    throw fail('AUDIENCE_NOT_ALLOWED');
  const scope = ScopeService.resolve(actor);
  let members;
  if (campaignId) {
    const campaign = await db.campaign.findFirst({
      where: scoped(campaignWhere(scope), { id: campaignId }),
      select: { id: true },
    });
    if (!campaign) throw fail('AUDIENCE_NOT_ALLOWED');
    const staff = await db.campaignStaff.findMany({
      where: { agencyId, campaignId, wilayaId },
      select: { userId: true },
    });
    const animateurs = await db.assignment.findMany({
      where: {
        campaignId,
        agencyId,
        status: 'approved',
        pointOfSale: wilayaId ? { wilayaId } : undefined,
      },
      select: { animateurId: true },
    });
    members = [
      ...new Set([
        ...staff.map(({ userId }) => userId),
        ...animateurs.map(({ animateurId }) => animateurId),
      ]),
    ];
  }
  const restricted = ['regional_manager', 'supervisor'].includes(role);
  return db.user.findMany({
    where: scoped(restricted ? await userWhere(scope, { db }) : { agencyId }, {
      AND: [
        { id: { not: id, in: members } },
        { role: { in: targetRoles }, status: 'active', ...(campaignId ? {} : { wilayaId }) },
      ],
    }),
    select: { id: true },
  });
}
const preview = async (actor, filters) => ({
  count: (await audience(prisma, actor, filters)).length,
});

function publish(actor, input) {
  return withTransaction(async (tx) => {
    const userIds = (await audience(tx, actor, input)).map(({ id }) => id);
    if (!userIds.length) throw fail('EMPTY_AUDIENCE');
    const row = await tx.announcement.create({
      data: { ...input, agencyId: actor.agencyId, authorId: actor.id, publishedAt: now() },
    });
    const eventId = randomUUID();
    await notificationService.notify(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      userIds,
      type,
      entityType: 'announcement',
      entityId: row.id,
      payload: { eventId },
    });
    await auditService.record(tx, {
      actor,
      action: type,
      entityType: 'announcement',
      entityId: row.id,
      after: {
        audienceCount: userIds.length,
        targetRoles: row.targetRoles,
        wilayaId: row.wilayaId,
      },
    });
    events.emit(tx, type, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      announcementId: row.id,
      userIds,
      eventId,
    });
    return { ...row, audienceCount: userIds.length };
  });
}

const recipient = (actor) => ({
  agencyId: actor.agencyId,
  userId: actor.id,
  entityType: 'announcement',
  type,
});
const author = { select: { id: true, fullName: true } };
async function list(actor, { page, pageSize }) {
  const notices = await prisma.notification.findMany({
    where: recipient(actor),
    select: { entityId: true },
  });
  const where = {
    agencyId: actor.agencyId,
    publishedAt: { not: null },
    OR: [
      { authorId: actor.id },
      { id: { in: notices.map(({ entityId }) => entityId).filter(Boolean) } },
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.announcement.findMany({
      where,
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: pageSize,
      skip: (page - 1) * pageSize,
      include: { author, reads: { where: { userId: actor.id }, select: { readAt: true } } },
    }),
    prisma.announcement.count({ where }),
  ]);
  return {
    data: rows.map(({ reads, ...row }) => ({ ...row, readAt: reads[0]?.readAt ?? null })),
    meta: { page, pageSize, total },
  };
}
function open(actor, id) {
  return withTransaction(async (tx) => {
    const row = await tx.announcement.findFirst({
      where: { id, agencyId: actor.agencyId, publishedAt: { not: null } },
      include: { author },
    });
    if (!row) throw new NotFoundError();
    if (row.authorId !== actor.id) {
      const notice = await tx.notification.findFirst({
        where: { ...recipient(actor), entityId: id },
        select: { id: true },
      });
      if (!notice) throw new NotFoundError();
    }
    const where = { announcementId_userId: { announcementId: id, userId: actor.id } };
    const prior = await tx.announcementRead.createMany({
      data: { announcementId: id, agencyId: actor.agencyId, userId: actor.id },
      skipDuplicates: true,
    });
    const receipt = await tx.announcementRead.findUniqueOrThrow({ where });
    if (prior.count)
      await auditService.record(tx, {
        actor,
        action: 'announcement.read',
        entityType: 'announcement',
        entityId: id,
      });
    return { ...row, readAt: receipt.readAt };
  });
}
async function reads(actor, id) {
  const row = await prisma.announcement.findFirst({
    where: { id, agencyId: actor.agencyId, publishedAt: { not: null } },
    include: { reads: { include: { user: author } } },
  });
  if (!row || (row.authorId !== actor.id && actor.role !== 'director')) throw new NotFoundError();
  const notices = await prisma.notification.findMany({
    where: { agencyId: actor.agencyId, entityType: 'announcement', entityId: id, type },
    select: { user: author },
  });
  const seen = new Map(
    row.reads
      .filter(({ userId }) => userId !== row.authorId)
      .map(({ user, readAt }) => [user.id, { ...user, readAt }]),
  );
  const notRead = Array.from(
    new Map(
      notices.filter(({ user }) => !seen.has(user.id)).map(({ user }) => [user.id, user]),
    ).values(),
  );
  return { read: Array.from(seen.values()), notRead };
}
export const announcementService = { preview, publish, list, open, reads };
