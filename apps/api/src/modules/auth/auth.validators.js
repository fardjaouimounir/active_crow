import { changePasswordBodySchema, loginBodySchema } from '@fieldflow/shared';
import { z } from 'zod';

export const loginSchemas = { body: loginBodySchema };

export const changePasswordSchemas = { body: changePasswordBodySchema };

/**
 * Endpoints that take no body. `.strict()` rejects any field, so a refresh token can never be
 * passed in the body: /auth/refresh reads the httpOnly cookie only.
 */
export const emptyBodySchemas = { body: z.object({}).strict() };
