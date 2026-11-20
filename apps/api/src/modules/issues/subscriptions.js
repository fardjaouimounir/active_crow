import { registerFileAccessPolicy } from '../files/fileAccessPolicies.js';
import { subscribe } from '../notifications/subscriptions.js';
import { canReadIssue } from './issues.policies.js';
import { getIssue } from './issues.repository.js';

registerFileAccessPolicy('issue_attachment', async (actor, file, db) => {
  const attachments = await db.issueAttachment.findMany({
    where: { agencyId: actor.agencyId, fileId: file.id },
    select: { issueId: true },
  });
  for (const { issueId } of attachments) {
    const issue = await getIssue(db, actor, issueId);
    if (issue && canReadIssue(actor, issue)) return { filename: 'issue-attachment' };
  }
  return null;
});

for (const action of ['created', 'assigned', 'status_changed', 'commented']) {
  subscribe(
    'issue.' + action,
    async (tx, { payload: { agencyId, issueId, assigneeId, commentAt } }) => {
      const issue = await tx.issue.findFirst({
        where: { id: issueId, agencyId },
        include: {
          pointOfSale: { select: { wilayaId: true } },
          campaign: { include: { wilayas: { include: { staff: true } } } },
          comments: {
            where: commentAt ? { createdAt: { lte: new Date(commentAt) } } : undefined,
            select: { authorId: true },
          },
        },
      });
      if (!issue) return;
      let ids;
      switch (action) {
        case 'created':
          ids = issue.campaign.wilayas
            .filter(({ wilayaId }) => !issue.pointOfSale || issue.pointOfSale.wilayaId === wilayaId)
            .flatMap(({ staff }) => staff.map(({ userId }) => userId));
          break;
        case 'assigned':
          ids = [assigneeId];
          break;
        case 'commented':
          ids = [issue.reportedById, assigneeId, ...issue.comments.map(({ authorId }) => authorId)];
          break;
        default:
          ids = [issue.reportedById, assigneeId];
      }
      const users = await tx.user.findMany({
        where: { agencyId, id: { in: [...new Set(ids.filter(Boolean))] } },
        select: { agencyId: true, id: true, role: true },
      });
      return {
        userIds: users.filter((user) => canReadIssue(user, issue)).map(({ id }) => id),
        entityType: 'issue',
        entityId: issueId,
        payload: {},
      };
    },
  );
}
