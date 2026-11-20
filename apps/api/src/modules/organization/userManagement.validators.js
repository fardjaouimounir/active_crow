import { USER_ROLES, USER_STATUSES } from '@fieldflow/shared';
import { z } from 'zod';

export {
  createUserSchema as createUser,
  updateUserSchema as updateUser,
  transferSchema as transferBody,
} from '@fieldflow/shared';

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
