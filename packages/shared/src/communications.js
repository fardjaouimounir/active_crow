import { z } from 'zod';
import { ISSUE_STATUSES } from './enums.js';

export const issueCategories = ['stock_shortage', 'pos_problem', 'absence', 'equipment', 'other'];
export const announcementRoles = ['supervisor', 'animateur', 'regional_manager', 'general_manager'];
const text = (min, max) =>
  z
    .string()
    .transform((value) =>
      Array.from(value)
        .filter((char) => {
          const code = char.charCodeAt(0);
          return code === 9 || code === 10 || (code >= 32 && (code < 127 || code > 159));
        })
        .join('')
        .trim(),
    )
    .pipe(z.string().min(min).max(max));
const id = z.uuid();
const number = (max) => z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(1).max(max));
export const communicationPaging = z.strictObject({
  page: number(1000000).default(1),
  pageSize: number(100).default(25),
});
export const notificationFilters = communicationPaging.extend({
  unread: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export const issueFilters = communicationPaging.extend({
  status: z.enum(ISSUE_STATUSES).optional(),
  category: z.enum(issueCategories).optional(),
  campaignId: id.optional(),
  wilayaId: number(32767).optional(),
  assignedToMe: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export const issueCreate = z.strictObject({
  campaignId: id,
  pointOfSaleId: id.optional(),
  stockItemId: id.optional(),
  category: z.enum(issueCategories),
  title: text(3, 120),
  description: text(0, 2000).optional(),
});
export const issueComment = z.strictObject({ body: text(1, 2000) });
export const issueChange = z.strictObject({
  version: z.int().positive(),
  resolutionNote: text(0, 2000).optional(),
});
export const issueAssign = z.strictObject({ version: z.int().positive(), assigneeId: id });
const roles = z
  .array(z.enum(announcementRoles))
  .min(1)
  .max(4)
  .refine((values) => new Set(values).size === values.length);
export const announcementPublish = z.strictObject({
  title: text(3, 120),
  body: text(1, 4000),
  campaignId: id.optional(),
  wilayaId: z.int().min(1).max(32767).optional(),
  targetRoles: roles,
});
export const announcementPreview = z.strictObject({
  campaignId: id.optional(),
  wilayaId: number(32767).optional(),
  targetRoles: z
    .string()
    .transform((value) => value.split(','))
    .pipe(roles),
});
