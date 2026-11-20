import { z } from 'zod';

export const CUSTOMER_FIELD_MODES = Object.freeze(['required', 'optional', 'hidden']);

/** Customer data collected on a sale (required for approval). */
export const customerFieldsSchema = z.strictObject({
  fullName: z.enum(CUSTOMER_FIELD_MODES),
  phone: z.enum(CUSTOMER_FIELD_MODES),
  consentRequired: z.boolean(),
});
