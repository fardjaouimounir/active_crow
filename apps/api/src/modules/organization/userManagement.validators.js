import { algerianPhoneSchema, USER_ROLES, USER_STATUSES } from '@fieldflow/shared';
import { z } from 'zod';

const text = (max) => z.string().trim().min(1).max(max);
const fields = {
  fullName: text(200),
  email: z.email().max(254).toLowerCase(),
  phone: algerianPhoneSchema.nullable(),
  wilayaId: z.int().min(1).max(32767).nullable(),
  communeId: z.int().positive().nullable(),
  profile: z.strictObject({
    experienceYears: z.int().min(0).max(100).nullable().optional(),
    languages: z.array(text(50)).max(30).optional(),
    skills: z.array(text(100)).max(100).optional(),
    notes: text(3000).nullable().optional(),
  }),
};

export const createUser = z.strictObject({
  ...fields,
  role: z.enum(USER_ROLES),
  managerId: z.uuid().optional(),
  phone: fields.phone.optional(),
  wilayaId: fields.wilayaId.optional(),
  communeId: fields.communeId.optional(),
  profile: fields.profile.optional(),
});

export const updateUser = z
  .strictObject(fields)
  .partial()
  .refine((data) => Object.keys(data).length > 0, 'Provide at least one field');

const integer = (max) => z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(1).max(max));

export const userListQuery = z.strictObject({
  role: z.enum(USER_ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  wilayaId: integer(32767).optional(),
  managerId: z.uuid().optional(),
  q: z.string().trim().max(200).optional(),
  sort: z
    .enum(['fullName:asc', 'fullName:desc', 'createdAt:asc', 'createdAt:desc'])
    .default('fullName:asc'),
  page: integer(1000000).default(1),
  pageSize: integer(100).default(25),
});

export const userParams = z.strictObject({ id: z.uuid() });
export const emptyInput = z.strictObject({});
export const transferBody = z.strictObject({
  newManagerId: z.uuid(),
  effectiveDate: z.iso.date(),
  reason: z.string().trim().min(1).max(1000),
});
