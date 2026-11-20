import { RULE_TYPES, promotionsPayloadSchema, transitionBodySchema } from '@fieldflow/shared';
import { z } from 'zod';

export { promotionsPayloadSchema as promotions, transitionBodySchema as transitionBody };

export const campaignParams = z.strictObject({ id: z.uuid() });
export const ruleSetParams = z.strictObject({ id: z.uuid(), rsId: z.uuid() });
export const ruleParams = z.strictObject({
  id: z.uuid(),
  rsId: z.uuid(),
  ruleType: z.enum(RULE_TYPES),
});
export const effectiveQuery = z.strictObject({
  at: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value))
    .optional(),
});
export const empty = z.strictObject({});
/** The rule config is validated by the service with the schema of `:ruleType`. */
export const anyConfig = z.unknown();
