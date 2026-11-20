import { scoped, userWhere } from '../../core/authz/index.js';
import { prisma } from '../../db/client.js';

export const userFields = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  wilayaId: true,
  communeId: true,
  createdAt: true,
  mustChangePassword: true,
};

export function visibleUser(db, scope, id, at) {
  return userWhere(scope, { at, db, reportingOnly: true }).then((where) =>
    db.user.findFirst({ where: scoped(where, { id }), select: userFields }),
  );
}

export function activeDirector(tx, scope) {
  return tx.user.findFirst({
    where: { agencyId: scope.agencyId, role: 'director', status: 'active' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: userFields,
  });
}

export function createUser(tx, scope, data) {
  return tx.user.create({ data: { ...data, agencyId: scope.agencyId }, select: userFields });
}

export function updateUser(tx, scope, id, data) {
  return tx.user.update({ where: { id, agencyId: scope.agencyId }, data, select: userFields });
}

export function findProfile(db, scope, userId) {
  return db.animateurProfile.findUnique({
    where: { userId, agencyId: scope.agencyId },
    select: { experienceYears: true, skills: true, languages: true, notes: true },
  });
}

export function saveProfile(tx, scope, userId, profile) {
  return tx.animateurProfile.upsert({
    where: { userId, agencyId: scope.agencyId },
    create: { skills: [], languages: [], ...profile, userId, agencyId: scope.agencyId },
    update: profile,
  });
}

export function activeDirectorCount(tx, scope) {
  return tx.user.count({ where: { agencyId: scope.agencyId, role: 'director', status: 'active' } });
}

export function findCommune(tx, communeId) {
  return tx.commune.findUnique({ where: { id: communeId }, select: { wilayaId: true } });
}

export function reportingLines(scope, userId, managerIds) {
  return prisma.reportingLine.findMany({
    where: {
      agencyId: scope.agencyId,
      userId,
      managerId: managerIds ? { in: managerIds } : undefined,
    },
    orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      managerId: true,
      validFrom: true,
      validTo: true,
      reason: true,
      manager: { select: { id: true, fullName: true, role: true } },
    },
  });
}
