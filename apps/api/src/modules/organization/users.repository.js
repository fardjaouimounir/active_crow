import { scoped, userWhere } from '../../core/authz/index.js';
import { prisma } from '../../db/client.js';
import { userFields } from './userManagement.repository.js';

export async function listUsers(
  scope,
  { role, status, wilayaId, managerId, clientId, q, sort, page, pageSize },
  at,
) {
  const where = scoped(await userWhere(scope, { at, reportingOnly: true }), {
    role: clientId ? 'client' : role,
    clientId,
    status,
    wilayaId,
    reportingLines: managerId
      ? {
          some: {
            agencyId: scope.agencyId,
            managerId,
            validFrom: { lte: at },
            OR: [{ validTo: null }, { validTo: { gt: at } }],
          },
        }
      : undefined,
    OR: q
      ? ['fullName', 'email', 'phone'].map((field) => ({
          [field]: { contains: q, mode: 'insensitive' },
        }))
      : undefined,
  });
  const [field, direction] = sort.split(':');
  const [data, total] = await prisma.$transaction(
    [
      prisma.user.findMany({
        where,
        select: userFields,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ [field]: direction }, { id: 'asc' }],
      }),
      prisma.user.count({ where }),
    ],
    { isolationLevel: 'RepeatableRead' },
  );
  return { data, meta: { page, pageSize, total } };
}

export async function countClientUsers(scope, clientIds, at) {
  if (!clientIds.length) return {};
  const rows = await prisma.user.groupBy({
    by: ['clientId'],
    where: scoped(await userWhere(scope, { at, reportingOnly: true }), {
      role: 'client',
      clientId: { in: clientIds },
    }),
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.clientId, row._count._all]));
}
