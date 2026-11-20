import { scoped, userWhere } from '../../core/authz/index.js';

const effectiveAt = (at) => ({
  validFrom: { lte: at },
  OR: [{ validTo: null }, { validTo: { gt: at } }],
});

export async function findTransferUser(tx, scope, id, at) {
  const visible = await userWhere(scope, { at, db: tx, reportingOnly: true });
  return tx.user.findFirst({
    where: scoped(visible, { id }),
    select: { id: true, role: true, status: true },
  });
}

export function findLine(tx, scope, userId, criteria) {
  return tx.reportingLine.findFirst({
    where: { agencyId: scope.agencyId, userId, ...criteria },
    orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  });
}

export function currentLine(tx, scope, userId, at) {
  return findLine(tx, scope, userId, effectiveAt(at));
}

export function scheduledLine(tx, scope, userId, at) {
  return findLine(tx, scope, userId, { validFrom: { gt: at } });
}

export function teamLines(tx, scope, managerId, at) {
  return tx.reportingLine.findMany({
    where: { agencyId: scope.agencyId, managerId, ...effectiveAt(at) },
    orderBy: { userId: 'asc' },
  });
}

export function closeLine(tx, scope, id, validTo) {
  return tx.reportingLine.update({ where: { id, agencyId: scope.agencyId }, data: { validTo } });
}

export function openLine(tx, scope, data) {
  return tx.reportingLine.create({ data: { ...data, agencyId: scope.agencyId } });
}

export function deleteLine(tx, scope, id) {
  return tx.reportingLine.delete({ where: { id, agencyId: scope.agencyId } });
}
