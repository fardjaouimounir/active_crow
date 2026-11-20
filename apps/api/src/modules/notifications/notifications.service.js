import { now } from '@fieldflow/shared';
import { AppError, NotFoundError } from '../../core/errors/index.js';
import { prisma } from '../../db/client.js';
import { withTransaction } from '../../db/transaction.js';

async function notify(tx, { agencyId, actorId, userIds, type, entityType, entityId, payload }) {
  const eventId = payload.eventId;
  if (!eventId) throw new AppError({ message: 'Notification requires an event id' });
  const ids = [...new Set(userIds)].filter((id) => id && id !== actorId);
  if (!ids.length) return;
  await tx.$queryRaw`SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtextextended(${eventId}, 0))`;
  const users = await tx.user.findMany({
    where: { agencyId, status: 'active', id: { in: ids } },
    select: { id: true },
  });
  const prior = await tx.notification.findMany({
    where: { agencyId, type, payload: { path: ['eventId'], equals: eventId } },
    select: { userId: true },
  });
  const seen = new Set(prior.map(({ userId }) => userId));
  const data = users
    .filter(({ id }) => !seen.has(id))
    .map(({ id }) => ({ agencyId, userId: id, type, entityType, entityId, payload }));
  if (data.length) await tx.notification.createMany({ data });
}

const own = (actor) => ({ agencyId: actor.agencyId, userId: actor.id });
async function list(actor, { page, pageSize, unread }) {
  const where = { ...own(actor), ...(unread ? { readAt: null } : {}) };
  const [data, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.notification.count({ where }),
  ]);
  return { data, meta: { page, pageSize, total } };
}
const unreadCount = (actor) =>
  prisma.notification.count({ where: { ...own(actor), readAt: null } });

function read(actor, id) {
  return withTransaction(async (tx) => {
    const where = { ...own(actor), ...(id ? { id } : {}) };
    if (id && !(await tx.notification.findFirst({ where, select: { id: true } })))
      throw new NotFoundError();
    const { count } = await tx.notification.updateMany({
      where: { ...where, readAt: null },
      data: { readAt: now() },
    });
    return { count };
  });
}
function cleanup() {
  return withTransaction((tx) =>
    tx.notification.deleteMany({
      where: {
        type: { not: 'announcement.published' },
        createdAt: { lt: new Date(now().getTime() - 90 * 86400000) },
      },
    }),
  );
}
export const notificationService = Object.freeze({ notify, list, unreadCount, read, cleanup });
