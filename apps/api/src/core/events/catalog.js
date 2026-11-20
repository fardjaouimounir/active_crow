import { z } from 'zod';

const id = z.uuid();
const base = { agencyId: id, actorId: id };
const campaign = z.strictObject({ ...base, campaignId: id, status: z.string() });
const assignment = z.strictObject({ ...base, assignmentId: id });
const issue = z.strictObject({
  ...base,
  issueId: id,
  assigneeId: id.nullable().optional(),
  commentAt: z.iso.datetime().optional(),
});
const stock = z.strictObject({ ...base, campaignId: id, movementId: id });
export const eventCatalog = Object.freeze({
  'campaign.status_changed': campaign,
  'assignment.proposed': assignment,
  'assignment.approved': assignment,
  'assignment.rejected': assignment,
  'assignment.cancelled': assignment,
  'assignment.ended': assignment,
  'assignment.replaced': assignment,
  'attendance.recorded': z.strictObject({
    ...base,
    campaignId: id,
    assignmentId: id,
    attendanceId: id,
    photoFileId: id.nullable(),
  }),
  'attendance.rejected': z.strictObject({
    ...base,
    campaignId: id,
    attendanceId: id,
    animateurId: id,
    reason: z.string(),
  }),
  'absence.recorded': z.strictObject({ ...base, campaignId: id, assignmentId: id, absenceId: id }),
  'visit.recorded': z.strictObject({ ...base, campaignId: id, visitId: id, pointOfSaleId: id }),
  'issue.created': issue,
  'issue.assigned': issue,
  'issue.status_changed': issue,
  'issue.commented': issue,
  'stock.transfer_created': stock,
  'stock.transfer_disputed': stock,
  'stock.adjustment_requested': stock,
  'stock.adjustment_decided': stock.extend({ decision: z.enum(['approved', 'rejected']) }),
  'announcement.published': z.strictObject({
    ...base,
    announcementId: id,
    userIds: z.array(id),
    eventId: id,
  }),
});
