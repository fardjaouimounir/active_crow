// Schemas of FieldFlow's own AI endpoints (the contract with the AI service is in aiContract.js).
import { z } from 'zod';
import { AI_CAPABILITIES, AI_LOCALES } from './aiContract.js';
import { AI_SUGGESTION_STATUSES } from './enums.js';

export const AI_REQUEST_STATUSES = Object.freeze(['queued', 'sent', 'send_failed', 'completed']);

const date = z.iso.date();

/** `POST /ai/requests`. Everything else (agency, requester, filters) is derived on the server. */
export const aiRequestInput = z
  .strictObject({
    capability: z.enum(AI_CAPABILITIES),
    subjectId: z.uuid(),
    locale: z.enum(AI_LOCALES).default('en'),
    /** Reporting period; defaults depend on the capability. `workDate` is the daily summary's day. */
    filters: z
      .strictObject({ workDate: date.optional(), from: date.optional(), to: date.optional() })
      .default({}),
  })
  .refine(({ filters: { from, to } }) => !from || !to || from <= to, {
    path: ['filters', 'to'],
    message: 'The end date must not precede the start date',
  });

const page = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

export const aiRequestFilters = z.strictObject({
  ...page,
  capability: z.enum(AI_CAPABILITIES).optional(),
  status: z.enum(AI_REQUEST_STATUSES).optional(),
  subjectId: z.uuid().optional(),
  from: date.optional(),
  to: date.optional(),
});

export const aiSuggestionFilters = z.strictObject({
  ...page,
  capability: z.enum(AI_CAPABILITIES).optional(),
  status: z.enum(AI_SUGGESTION_STATUSES).optional(),
  subjectId: z.uuid().optional(),
  from: date.optional(),
  to: date.optional(),
});

export const aiAcceptInput = z.strictObject({ note: z.string().trim().max(1000).optional() });
export const aiRejectInput = z.strictObject({ note: z.string().trim().min(1).max(1000) });
