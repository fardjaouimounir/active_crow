// Prisma `where` builders, one per resource, from a scope (docs/01 §2.3). A record is visible when
// it is the user's own, belongs to someone under them in the tree at the date of the record, or
// belongs to a campaign explicitly assigned to them.
//
// Pattern for later modules: add `<resource>Where(scope, options)` here, start with
// `assertScope(scope)`, return `{}` only for SYSTEM_SCOPE and always include `agencyId` otherwise.
import { descendantIds } from '../../modules/organization/hierarchy.repository.js';
import { prisma } from '../../db/client.js';
import { businessDate } from '../time/clock.js';
import { SCOPE_LEVELS, SYSTEM_SCOPE } from './scopeService.js';

const USER_LEVELS = new Set(['regional', 'supervisor', 'self']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Regional managers see their reporting tree down to this many levels. */
export const REPORTING_TREE_MAX_DEPTH = 3;

/**
 * Throws unless `scope` is SYSTEM_SCOPE or a well-formed agency-bound scope.
 * @param {unknown} scope
 * @returns {boolean} true for SYSTEM_SCOPE
 */
export function assertScope(scope) {
  if (scope === SYSTEM_SCOPE) return true;
  const s = /** @type {any} */ (scope);
  const valid =
    s !== null &&
    typeof s === 'object' &&
    SCOPE_LEVELS.includes(s.level) &&
    s.level !== 'system' &&
    typeof s.agencyId === 'string' &&
    (!USER_LEVELS.has(s.level) || typeof s.userId === 'string') &&
    (s.level !== 'client' || typeof s.clientId === 'string');
  if (!valid) throw new Error('A valid scope is required to build a query filter');
  return false;
}

/**
 * ANDs a resource filter (from a builder below) with the caller's own filter. Repositories use it
 * for every query on business data, e.g. `prisma.campaign.findFirst({ where: scoped(campaignWhere(scope), { id }) })`.
 * @param {object} scopeFilter
 * @param {object} [where]
 */
export function scoped(scopeFilter, where) {
  if (scopeFilter === null || typeof scopeFilter !== 'object') {
    throw new Error('scoped() needs the scope filter of a resource');
  }
  if (!where || Object.keys(where).length === 0) return scopeFilter;
  return { AND: [scopeFilter, where] };
}

/** @param {string} userId @param {'regional_manager' | 'supervisor'} role */
const staffedAs = (userId, role) => ({
  wilayas: { some: { staff: { some: { userId, role } } } },
});

/**
 * Campaigns visible to the scope.
 * agency: all of the agency · regional: staffed as regional_manager · supervisor: staffed as
 * supervisor or supervisor_id on any assignment · self: has an approved assignment · client: own client.
 * @param {import('./scopeService.js').Scope} scope
 */
export function campaignWhere(scope) {
  if (assertScope(scope)) return {};
  const { agencyId } = scope;
  switch (scope.level) {
    case 'agency':
      return { agencyId };
    case 'regional':
      return { agencyId, ...staffedAs(scope.userId, 'regional_manager') };
    case 'supervisor':
      return {
        agencyId,
        OR: [
          staffedAs(scope.userId, 'supervisor'),
          { assignments: { some: { supervisorId: scope.userId } } },
        ],
      };
    case 'self':
      return {
        agencyId,
        assignments: { some: { animateurId: scope.userId, status: 'approved' } },
      };
    case 'client':
      return { agencyId, clientId: scope.clientId };
  }
}

/** @param {Date | string | undefined} at @returns {string} YYYY-MM-DD */
function toBusinessDate(at) {
  if (at === undefined) return businessDate();
  if (at instanceof Date) return at.toISOString().slice(0, 10);
  if (typeof at === 'string' && ISO_DATE.test(at)) return at;
  throw new Error('`at` must be a Date or a YYYY-MM-DD string');
}

/**
 * Ids under a regional manager at `at`: their reporting tree (lines valid at `at`, up to 3 levels)
 * plus the Animateurs and supervisors of assignments in campaigns they are staffed on.
 */
async function regionalUserIds(db, { agencyId, userId }, at) {
  const rows = await db.$queryRaw`
    SELECT unnest(ARRAY[a.animateur_id, a.supervisor_id]) AS id
    FROM assignments a
    WHERE a.agency_id = ${agencyId}::uuid
      AND EXISTS (
        SELECT 1 FROM campaign_staff cs
        WHERE cs.campaign_id = a.campaign_id
          AND cs.agency_id = ${agencyId}::uuid
          AND cs.user_id = ${userId}::uuid
          AND cs.role = 'regional_manager'
      )`;
  return [
    ...(await descendantIds(db, { agencyId, userId }, at, REPORTING_TREE_MAX_DEPTH)),
    ...rows.map(({ id }) => id),
  ];
}

/** Ids under a supervisor at `at`: direct reports valid at `at` plus Animateurs on assignments they supervise. */
async function supervisorUserIds(db, { agencyId, userId }, at) {
  const rows = await db.$queryRaw`
    SELECT a.animateur_id AS id
    FROM assignments a
    WHERE a.agency_id = ${agencyId}::uuid
      AND a.supervisor_id = ${userId}::uuid`;
  return [...(await descendantIds(db, { agencyId, userId }, at, 1)), ...rows.map(({ id }) => id)];
}

/**
 * Users visible to the scope at business date `at` (default: today in Africa/Algiers). Pass the
 * date of the record being read, so a supervisor keeps seeing an Animateur's records from the
 * period they supervised them (docs/01 §2.3, Q-07).
 * agency: all users of the agency · regional / supervisor: themselves + their tree at `at` +
 * people on their campaigns' / supervised assignments · self: themselves · client: nobody.
 * @param {import('./scopeService.js').Scope} scope
 * @param {{ at?: Date | string, reportingOnly?: boolean, db?: import('@prisma/client').Prisma.TransactionClient }} [options]
 */
export async function userWhere(scope, { at, reportingOnly = false, db = prisma } = {}) {
  if (assertScope(scope)) return {};
  const { agencyId } = scope;
  switch (scope.level) {
    case 'agency':
      return { agencyId };
    case 'regional':
    case 'supervisor': {
      const lookup = scope.level === 'regional' ? regionalUserIds : supervisorUserIds;
      const date = toBusinessDate(at);
      const ids = reportingOnly
        ? await descendantIds(
            db,
            scope,
            date,
            scope.level === 'regional' ? REPORTING_TREE_MAX_DEPTH : 1,
          )
        : await lookup(db, scope, date);
      return { agencyId, id: { in: [...new Set([scope.userId, ...ids])] } };
    }
    case 'self':
      return { agencyId, id: scope.userId };
    case 'client':
      return { agencyId, id: { in: [] } };
  }
}
