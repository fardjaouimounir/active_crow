// Gift and sample inventory (M8): input schemas shared by the API and the web forms, plus the one
// pure arithmetic rule of the reconciliation report.
import { z } from 'zod';
import { STOCK_MOVEMENT_STATUSES, STOCK_MOVEMENT_TYPES } from './enums.js';

const id = z.uuid();
const date = z.iso.date();
const integer = (max) => z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(1).max(max));

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const MAX_STOCK_LINES = 50;
export const MAX_STOCK_QUANTITY = 100_000;

export const ADJUSTMENT_REASONS = Object.freeze(['damaged', 'lost', 'stolen', 'count_correction']);
/** Reasons that cannot be accepted without a photo (E-10). */
export const PROOF_REQUIRED_REASONS = Object.freeze(['lost', 'stolen']);
export const DISPUTE_DECISIONS = Object.freeze(['return_to_sender', 'loss']);
export const RETURN_DESTINATIONS = Object.freeze(['user', 'warehouse', 'client']);
/** Campaign statuses in which each kind of stock action is accepted. */
export const STOCK_STATUS_GATES = Object.freeze({
  stock_in: Object.freeze(['planning', 'assigned', 'active', 'suspended']),
  transfer: Object.freeze(['assigned', 'active', 'suspended']),
  return: Object.freeze(['active', 'suspended', 'completed']),
  settle: Object.freeze(['assigned', 'active', 'suspended', 'completed']),
});

const quantity = z.int().min(1).max(MAX_STOCK_QUANTITY);
const reference = z.string().trim().min(1).max(60);
const note = z.string().trim().min(3).max(500);
const uniqueItems = (lines) => new Set(lines.map((line) => line.stockItemId)).size === lines.length;
const uniqueMessage = { message: 'Each stock item may appear once', path: [] };
const lineList = (line) =>
  z.array(line).min(1).max(MAX_STOCK_LINES).refine(uniqueItems, uniqueMessage);

export const stockLine = z.strictObject({ stockItemId: id, quantity });
export const stockLines = lineList(stockLine);

export const stockInBody = z.strictObject({ lines: stockLines, reference, note: note.optional() });
export const transferBody = z.strictObject({
  recipientUserId: id,
  lines: stockLines,
  note: note.optional(),
});
export const returnBody = z
  .strictObject({
    destination: z.enum(RETURN_DESTINATIONS),
    recipientUserId: id.optional(),
    reference: reference.optional(),
    lines: stockLines,
    note: note.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.destination === 'user' && !value.recipientUserId)
      ctx.addIssue({ code: 'custom', path: ['recipientUserId'], message: 'Required' });
    if (value.destination !== 'user' && value.recipientUserId)
      ctx.addIssue({ code: 'custom', path: ['recipientUserId'], message: 'Not allowed here' });
    if (value.destination === 'client' && !value.reference)
      ctx.addIssue({ code: 'custom', path: ['reference'], message: 'Required' });
  });
export const confirmBody = z.strictObject({
  lines: lineList(
    z.strictObject({
      stockItemId: id,
      quantityReceived: z.int().min(0).max(MAX_STOCK_QUANTITY),
    }),
  ),
});
export const emptyBody = z.strictObject({});
export const resolveBody = z
  .strictObject({
    lines: lineList(z.strictObject({ stockItemId: id, decision: z.enum(DISPUTE_DECISIONS) })),
    note: note.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.lines.some((line) => line.decision === 'loss') && !value.note)
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'A reason is required for a loss' });
  });
export const adjustmentBody = z.strictObject({
  holderUserId: id.optional(),
  reason: z.enum(ADJUSTMENT_REASONS),
  note,
  lines: stockLines,
});
export const adjustmentApprovalBody = z.strictObject({ note: note.optional() });
export const adjustmentRejectionBody = z.strictObject({ note });

export const movementFilters = z
  .strictObject({
    page: integer(1_000_000).default(1),
    pageSize: integer(100).default(25),
    type: z.enum(STOCK_MOVEMENT_TYPES).optional(),
    status: z.enum(STOCK_MOVEMENT_STATUSES).optional(),
    holderUserId: id.optional(),
    stockItemId: id.optional(),
    from: date.optional(),
    to: date.optional(),
  })
  .refine(({ from, to }) => !from || !to || from <= to, { path: ['to'], message: 'Before from' });
export const recipientsQuery = z.strictObject({ direction: z.enum(['down', 'up']) });

/**
 * FR-083: received − sent − returned − distributed − adjusted must equal the balance.
 * @param {{ received: number, sent: number, returned: number, distributed: number, adjusted: number, balance: number }} row
 */
export function reconciliationCheck(row) {
  const expected = row.received - row.sent - row.returned - row.distributed - row.adjusted;
  return { ok: expected === row.balance, difference: row.balance - expected };
}
