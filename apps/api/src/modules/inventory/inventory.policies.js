// Who may see, send to and decide on stock of a campaign. Answers only; nothing is mutated here.
// Scope is derived from campaign staff and approved assignments (never from ids in a request).
import { today } from '@fieldflow/shared';
import { prisma } from '../../db/client.js';

const AGENCY_WIDE = new Set(['director', 'general_manager']);
const asDate = (iso) => new Date(iso + 'T00:00:00.000Z');

export const isAgencyWide = (actor) => AGENCY_WIDE.has(actor.role);

/** Wilayas of the campaign where the user is staffed in `role`. */
async function staffedWilayas(db, campaignId, userId, role) {
  const rows = await db.campaignStaff.findMany({
    where: { campaignId, userId, role },
    select: { wilayaId: true },
  });
  return rows.map(({ wilayaId }) => wilayaId);
}

async function staffUsers(db, campaignId, role, wilayaIds) {
  const rows = await db.campaignStaff.findMany({
    where: {
      campaignId,
      role,
      ...(wilayaIds ? { wilayaId: { in: wilayaIds } } : {}),
      user: { status: 'active' },
    },
    select: { user: { select: { id: true, fullName: true, role: true } } },
    orderBy: { user: { fullName: 'asc' } },
  });
  return [...new Map(rows.map(({ user }) => [user.id, user])).values()];
}

/**
 * Holder users whose stock `actor` may see in the campaign; `null` means all (director, general
 * manager). Regional manager: themselves, the supervisors staffed in their wilayas and the
 * Animateurs those supervisors (or their wilayas' points of sale) cover. Supervisor: themselves and
 * their Animateurs. Animateur: themselves.
 * @returns {Promise<Set<string> | null>}
 */
export async function holderUserIdsInScope(db, actor, campaignId) {
  if (isAgencyWide(actor)) return null;
  const ids = new Set([actor.id]);
  if (actor.role === 'regional_manager') {
    const wilayas = await staffedWilayas(db, campaignId, actor.id, 'regional_manager');
    const supervisors = await staffUsers(db, campaignId, 'supervisor', wilayas);
    supervisors.forEach(({ id }) => ids.add(id));
    const covered = await db.assignment.findMany({
      where: {
        campaignId,
        status: 'approved',
        OR: [
          { supervisorId: { in: supervisors.map(({ id }) => id) } },
          { pointOfSale: { wilayaId: { in: wilayas } } },
        ],
      },
      select: { animateurId: true },
    });
    covered.forEach(({ animateurId }) => ids.add(animateurId));
  } else if (actor.role === 'supervisor') {
    const own = await db.assignment.findMany({
      where: { campaignId, status: 'approved', supervisorId: actor.id },
      select: { animateurId: true },
    });
    own.forEach(({ animateurId }) => ids.add(animateurId));
  }
  return ids;
}

/**
 * BR-44 / FR-084: who may approve an adjustment or resolve a dispute about a holder's stock.
 * Director and general manager always; a regional manager when the holder is in their scope; never
 * the holder themselves and never the people in `excluded` (who requested, sent or confirmed the
 * stock action). `holderUserId` may be a list (a dispute has two parties: none of them may
 * decide); `null` entries (the warehouse) are ignored.
 * @param {{ id: string, role: string }} actor
 * @param {{ id: string }} campaign
 * @param {string | null | Array<string | null>} holderUserId
 * @param {object} [db]
 */
export async function canApproveStockAction(
  actor,
  campaign,
  holderUserId,
  db = prisma,
  excluded = [],
) {
  const holders = [holderUserId].flat().filter(Boolean);
  if (holders.includes(actor.id) || excluded.includes(actor.id)) return false;
  if (isAgencyWide(actor)) return true;
  if (actor.role !== 'regional_manager') return false;
  const scope = await holderUserIdsInScope(db, actor, campaign.id);
  return holders.length > 0 && holders.every((id) => scope.has(id));
}

/** Active users who could decide about the holders' stock (for notifications). */
export async function eligibleApprovers(db, campaign, holderUserIds, excluded = []) {
  const candidates = await db.user.findMany({
    where: {
      agencyId: campaign.agencyId,
      status: 'active',
      OR: [
        { role: { in: ['director', 'general_manager'] } },
        { role: 'regional_manager', campaignStaff: { some: { campaignId: campaign.id } } },
      ],
    },
    select: { id: true, role: true },
  });
  const allowed = [];
  for (const user of candidates) {
    if (await canApproveStockAction(user, campaign, holderUserIds, db, excluded))
      allowed.push(user.id);
  }
  return allowed;
}

const user = (row) => ({ kind: 'user', userId: row.id, fullName: row.fullName, role: row.role });
const warehouse = { kind: 'warehouse' };
const client = { kind: 'client' };

/**
 * The valid counterparts of `actor` for a new transfer (`down`) or return (`up`) in the campaign.
 * Down: warehouse → regional manager or supervisor on staff; regional manager → supervisors in
 * their wilayas; supervisor → Animateurs with an approved current or upcoming assignment they
 * supervise. Up: Animateur → supervisor of an approved assignment; supervisor → regional manager of
 * their wilaya or the warehouse; regional manager → warehouse; director → the client.
 * @returns {Promise<Array<object>>}
 */
export async function recipientsFor(db, actor, campaign, direction) {
  const id = campaign.id;
  if (direction === 'down') {
    if (isAgencyWide(actor)) {
      const managers = await staffUsers(db, id, 'regional_manager');
      const supervisors = await staffUsers(db, id, 'supervisor');
      return [...new Map([...managers, ...supervisors].map((row) => [row.id, row])).values()].map(
        user,
      );
    }
    if (actor.role === 'regional_manager') {
      const wilayas = await staffedWilayas(db, id, actor.id, 'regional_manager');
      return (await staffUsers(db, id, 'supervisor', wilayas)).map(user);
    }
    if (actor.role === 'supervisor') {
      const rows = await db.assignment.findMany({
        where: {
          campaignId: id,
          status: 'approved',
          supervisorId: actor.id,
          endDate: { gte: asDate(today()) },
          animateur: { status: 'active' },
        },
        select: { animateur: { select: { id: true, fullName: true, role: true } } },
      });
      const unique = new Map(rows.map(({ animateur }) => [animateur.id, animateur]));
      return [...unique.values()].sort((a, b) => a.fullName.localeCompare(b.fullName)).map(user);
    }
    return [];
  }
  if (actor.role === 'director') return [client];
  if (actor.role === 'regional_manager') return [warehouse];
  if (actor.role === 'supervisor') {
    const wilayas = await staffedWilayas(db, id, actor.id, 'supervisor');
    return [...(await staffUsers(db, id, 'regional_manager', wilayas)).map(user), warehouse];
  }
  if (actor.role === 'animateur') {
    const rows = await db.assignment.findMany({
      where: {
        campaignId: id,
        status: 'approved',
        animateurId: actor.id,
        supervisor: { status: 'active' },
      },
      select: { supervisor: { select: { id: true, fullName: true, role: true } } },
    });
    return [...new Map(rows.map(({ supervisor }) => [supervisor.id, supervisor])).values()].map(
      user,
    );
  }
  return [];
}
