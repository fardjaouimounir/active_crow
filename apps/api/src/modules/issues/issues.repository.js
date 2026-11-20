import { issueScope } from './issues.policies.js';

const person = { select: { id: true, fullName: true, role: true } };
const details = {
  campaign: {
    select: {
      id: true,
      name: true,
      status: true,
      clientId: true,
      wilayas: { include: { staff: true } },
    },
  },
  pointOfSale: { select: { id: true, name: true, wilayaId: true } },
  reportedBy: person,
  assignedTo: person,
  attachments: { where: { commentId: null }, select: { fileId: true } },
};
export const getIssue = (db, actor, id) =>
  db.issue.findFirst({ where: { AND: [issueScope(actor), { id }] }, include: details });
export function listIssues(db, actor, filters) {
  const { status, category, campaignId, wilayaId, assignedToMe } = filters;
  return db.issue.findMany({
    where: {
      AND: [
        issueScope(actor),
        {
          status,
          category,
          campaignId,
          pointOfSale: wilayaId ? { wilayaId } : undefined,
          assignedToId: assignedToMe ? actor.id : undefined,
        },
      ],
    },
    include: details,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}
export function campaignForIssue(db, actor, id) {
  return db.campaign.findFirst({
    where: { id, agencyId: actor.agencyId },
    include: {
      wilayas: { include: { staff: true } },
      pointsOfSale: {
        include: { pointOfSale: { select: { id: true, wilayaId: true, deletedAt: true } } },
      },
    },
  });
}
export const comments = (db, issue) =>
  db.issueComment.findMany({
    where: { issueId: issue.id, agencyId: issue.agencyId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { author: person, attachments: { select: { fileId: true } } },
  });

export async function lockCampaignStatus(db, agencyId, campaignId) {
  const [campaign] =
    await db.$queryRaw`SELECT status::text AS status FROM campaigns WHERE id = ${campaignId}::uuid AND agency_id = ${agencyId}::uuid FOR SHARE`;
  return campaign?.status;
}
