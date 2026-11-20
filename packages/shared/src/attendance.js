/** Present a checkpoint without creating a database row for a missing proof. */
export function slotStatus(_expected, record, absence) {
  const activeAbsence = absence && !absence.voidedAt;
  const status =
    activeAbsence && (!record || record.status === 'rejected')
      ? `absent_${absence.type}`
      : (record?.status ?? 'not_sent');
  return { status, isLate: record?.isLate ?? false, flags: record?.flags ?? [] };
}
import { z } from 'zod';
import { issueCreate } from './communications.js';

export const attendanceReason = z.strictObject({ reason: z.string().trim().min(3).max(300) });
export const attendanceOverride = z.strictObject({
  status: z.enum(['verified', 'rejected']),
  note: attendanceReason.shape.reason,
});
export const absenceInput = z.strictObject({
  type: z.enum(['justified', 'unjustified']),
  reason: z.string().trim().min(1).max(300).optional(),
  replacementAssignmentId: z.uuid().optional(),
});
export const hasAbsenceReason = (body) => body.type !== 'justified' || Boolean(body.reason);
export const absenceBody = absenceInput
  .extend({ workDate: z.iso.date() })
  .refine(hasAbsenceReason, { path: ['reason'], message: 'Reason required' });
export const visitInput = z.strictObject({
  pointOfSaleId: z.uuid(),
  notes: z.string().trim().max(1000).optional(),
  observedAnimateurIds: z.array(z.uuid()).max(200).default([]),
  issues: z
    .array(issueCreate.pick({ category: true, title: true, description: true }))
    .max(5)
    .default([]),
});
