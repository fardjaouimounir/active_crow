import { scoped } from '../../core/authz/scopeFilters.js';
import { agencyWhere } from './sales.repository.js';

export const tombola = (db, scope, id) =>
  db.tombola.findFirst({ where: scoped(agencyWhere(scope), { id }) });
export const campaignTombolas = (db, scope, campaignId) =>
  db.tombola.findMany({
    where: scoped(agencyWhere(scope), { campaignId }),
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    include: { _count: { select: { entries: true } } },
  });
export const create = (db, scope, data) =>
  db.tombola.create({ data: { ...data, agencyId: scope.agencyId } });
export const update = (db, scope, id, data) =>
  db.tombola.update({
    where: { id, agencyId: scope.agencyId },
    data,
  });
export const count = (db, scope, where) =>
  db.tombolaEntry.count({ where: scoped(agencyWhere(scope), where) });

export async function lock(db, scope, ids) {
  if (!ids.length) return;
  await db.$queryRaw`SELECT id FROM tombolas WHERE agency_id = ${scope.agencyId}::uuid
    AND id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
}

export async function issueEntries(db, scope, sale, customerId, units, now) {
  const rows = await db.$queryRaw`
    SELECT id FROM tombolas WHERE agency_id = ${scope.agencyId}::uuid
      AND campaign_id = ${sale.campaignId}::uuid AND status = 'open'
      AND registration_ends_at > ${now} ORDER BY id FOR UPDATE`;
  const result = [];
  for (const { id } of rows) {
    const config = await tombola(db, scope, id);
    const requested = config.entriesPerBasis * (config.entryBasis === 'per_unit' ? units : 1);
    const used =
      config.maxEntriesPerCustomer === null
        ? 0
        : await count(db, scope, { tombolaId: id, customerId, status: 'valid' });
    const total = Math.min(
      requested,
      config.maxEntriesPerCustomer === null
        ? requested
        : Math.max(0, config.maxEntriesPerCustomer - used),
    );
    if (!total) continue;
    const { _max } = await db.tombolaEntry.aggregate({
      where: scoped(agencyWhere(scope), { tombolaId: id }),
      _max: { entryNumber: true },
    });
    const last = _max.entryNumber ?? 0;
    await db.$executeRaw`
      INSERT INTO tombola_entries (agency_id,tombola_id,entry_number,customer_id,sale_id)
      SELECT ${scope.agencyId}::uuid,${id}::uuid,n,${customerId}::uuid,${sale.id}::uuid
      FROM generate_series(${last + 1}::int,${last + total}::int) n`;
    result.push({
      tombolaId: id,
      tombola: config.name,
      numbers: Array.from({ length: total }, (_, index) => last + index + 1),
    });
  }
  return result;
}
export const excludeSale = (db, scope, saleId) =>
  db.tombolaEntry.updateMany({
    where: scoped(agencyWhere(scope), { saleId }),
    data: { status: 'excluded', excludedReason: 'sale_voided' },
  });
export const entries = (db, scope, where, skip, take) =>
  db.tombolaEntry.findMany({
    where: scoped(agencyWhere(scope), where),
    orderBy: { entryNumber: 'asc' },
    skip,
    take,
    include: {
      customer: { select: { id: true, fullName: true, phone: true } },
    },
  });

export const entryScopes = (db, scope, tombolaId) =>
  db.sale.findMany({
    where: scoped(agencyWhere(scope), { tombolaEntries: { some: { tombolaId } } }),
    select: { id: true, agencyId: true, workDate: true, animateurId: true, supervisorId: true },
  });
export function closeExpired(db, scope, now) {
  agencyWhere(scope);
  return db.$executeRaw`
    WITH due AS (SELECT id FROM tombolas WHERE status = 'open'
      AND registration_ends_at <= ${now} ORDER BY id FOR UPDATE)
    UPDATE tombolas t SET status = 'closed', updated_at = ${now}
    FROM due WHERE t.id = due.id`;
}

export function entryCountsBySale(db, scope, campaignId) {
  agencyWhere(scope);
  return db.$queryRaw`
    SELECT e.tombola_id AS "tombolaId", s.agency_id AS "agencyId",
      s.supervisor_id AS "supervisorId", s.animateur_id AS "animateurId",
      s.work_date AS "workDate", COUNT(*)::int AS "entryCount"
    FROM tombola_entries e JOIN sales s ON s.id = e.sale_id AND s.agency_id = e.agency_id
    WHERE e.agency_id = ${scope.agencyId}::uuid AND s.campaign_id = ${campaignId}::uuid
    GROUP BY e.tombola_id, s.agency_id, s.supervisor_id, s.animateur_id, s.work_date`;
}
