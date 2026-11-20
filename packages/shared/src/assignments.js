import { z } from 'zod';
import { ASSIGNMENT_STATUSES } from './enums.js';

const id = z.uuid();
const date = z.iso.date();
const note = z.string().trim().min(1).max(2000);
const time = z.iso.time({ precision: -1 });
export const assignmentProposal = z.strictObject({
  animateurId: id,
  pointOfSaleId: id,
  supervisorId: id.optional(),
  startDate: date,
  endDate: date,
  workDays: z.array(z.int()).optional(),
  shiftStart: time.optional(),
  shiftEnd: time.optional(),
});
export const assignmentProposals = z.array(assignmentProposal).min(1).max(100);
export const assignmentDecision = z.strictObject({ note: z.string().trim().max(2000).optional() });
export const assignmentDecisions = z
  .array(
    assignmentDecision.extend({
      id,
      decision: z.enum(['approve', 'reject']),
    }),
  )
  .min(1)
  .max(100);
export const assignmentEnd = z.strictObject({ endDate: date, reason: note });
export const assignmentReplacement = z.strictObject({
  animateurId: id,
  fromDate: date,
  reason: note,
});

const integer = (max) => z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(1).max(max));
export const assignmentPaging = z.strictObject({
  page: integer(1000000).default(1),
  pageSize: integer(100).default(25),
});
export const assignmentFilters = assignmentPaging
  .extend({
    status: z.enum(ASSIGNMENT_STATUSES).optional(),
    wilayaId: integer(32767).optional(),
    pointOfSaleId: id.optional(),
    supervisorId: id.optional(),
    animateurId: id.optional(),
    from: date.optional(),
    to: date.optional(),
  })
  .refine(({ from, to }) => !from || !to || from <= to);
export const assignmentCandidates = z
  .strictObject({
    wilayaId: integer(32767),
    from: date,
    to: date,
    q: z.string().trim().max(200).optional(),
  })
  .refine(({ from, to }) => from <= to);
export const staffingDate = z.strictObject({ date: date.optional() });
