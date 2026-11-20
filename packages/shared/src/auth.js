// Auth request schemas and the password policy, shared by the API (validation) and the web (forms).
import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const EMAIL_MAX_LENGTH = 254;

/**
 * Password policy rules. Each failed rule is reported with its id as the Zod issue message, so the
 * web app can translate it and the API can list it in WEAK_PASSWORD details.
 */
export const PASSWORD_RULES = Object.freeze([
  { id: 'min_length', test: (value) => value.length >= PASSWORD_MIN_LENGTH },
  { id: 'max_length', test: (value) => value.length <= PASSWORD_MAX_LENGTH },
  { id: 'letter', test: (value) => /\p{L}/u.test(value) },
  { id: 'digit', test: (value) => /\p{Nd}/u.test(value) },
]);

/** @param {string} value @returns {string[]} ids of the rules `value` breaks */
export function passwordPolicyViolations(value) {
  return PASSWORD_RULES.filter((rule) => !rule.test(value)).map((rule) => rule.id);
}

/** A new password: min 10, max 128 characters, at least one letter and one digit. */
export const passwordSchema = z.string().superRefine((value, ctx) => {
  for (const id of passwordPolicyViolations(value)) {
    ctx.addIssue({ code: 'custom', message: id });
  }
});

/** Trimmed and lower-cased before validation. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX_LENGTH)
  .pipe(z.email({ message: 'invalid_email' }));

/** POST /auth/login. The password is only checked for presence and size here, never the policy. */
export const loginBodySchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, 'required').max(PASSWORD_MAX_LENGTH),
  })
  .strict();

/**
 * POST /auth/change-password. `newPassword` is checked against the policy by the service so a
 * failure is reported as WEAK_PASSWORD rather than a generic validation error.
 */
export const changePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1, 'required').max(PASSWORD_MAX_LENGTH),
    newPassword: z.string().min(1, 'required').max(1024),
  })
  .strict();
