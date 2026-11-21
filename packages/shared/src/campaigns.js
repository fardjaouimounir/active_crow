// Campaigns core (M3 part 1): shared by the API validators and web forms.
import { z } from 'zod';
import { moneyInputSchema, moneySchema } from './catalog.js';
import { campaignStaffRoleSchema, fileVisibilitySchema } from './enums.js';
import { algerianPhoneSchema } from './organization.js';

/** Q-09: who approves assignment proposals, chosen per campaign. */
export const APPROVER_ROLES = Object.freeze(['director', 'general_manager', 'regional_manager']);

const text = (max) => z.string().trim().min(1).max(max);
const wilayaId = z.int().min(1).max(69);
const dateRange = {
  check: (value) => !value.startDate || !value.endDate || value.endDate >= value.startDate,
  options: { path: ['endDate'], message: 'The end date must be on or after the start date' },
};
const unique = (ids) => new Set(ids).size === ids.length;
const duplicates = { message: 'Duplicate values are not allowed' };

const campaignFields = {
  clientId: z.uuid(),
  name: text(200),
  description: text(5000).nullable().optional(),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  budgetAmount: moneySchema.nullable().optional(),
  assignmentApproverRole: z.enum(APPROVER_ROLES).default('regional_manager'),
};

export const createCampaignSchema = z
  .strictObject(campaignFields)
  .refine(dateRange.check, dateRange.options);

/** Everything but `clientId`, which never changes after creation. */
export const updateCampaignSchema = z
  .strictObject({
    name: campaignFields.name.optional(),
    description: campaignFields.description,
    startDate: campaignFields.startDate.optional(),
    endDate: campaignFields.endDate.optional(),
    budgetAmount: campaignFields.budgetAmount,
    assignmentApproverRole: z.enum(APPROVER_ROLES).optional(),
    version: z.int().positive(),
  })
  .refine((value) => Object.keys(value).length > 1, 'Provide at least one field')
  .refine(dateRange.check, dateRange.options);

export const campaignWilayasSchema = z.strictObject({
  wilayas: z
    // `requiredAnimateurs` is ignored: the wilaya need is the sum of its supervisors' quotas.
    .array(z.strictObject({ wilayaId, requiredAnimateurs: z.int().min(0).max(500).optional() }))
    .max(69)
    .refine((rows) => unique(rows.map((row) => row.wilayaId)), duplicates),
});

const quota = z.int().min(0).max(500);

export const campaignStaffSchema = z.strictObject({
  userId: z.uuid(),
  wilayaId,
  role: campaignStaffRoleSchema,
  /** Supervisors only: how many Animateurs they must bring to the campaign. */
  requiredAnimateurs: quota.optional(),
});

export const staffQuotaSchema = z.strictObject({ requiredAnimateurs: quota });

/** The supervisor's own Animateurs for a campaign: pick an existing one, or create a new one. */
export const teamAnimateurSchema = z.strictObject({
  animateurId: z.uuid(),
  /** Director / regional manager only: which supervisor's team. */
  supervisorId: z.uuid().optional(),
});

export const newTeamAnimateurSchema = z.strictObject({
  fullName: text(200),
  email: z.email().max(254).toLowerCase(),
  phone: algerianPhoneSchema.optional(),
  wilayaId: z.int().min(1).max(69),
  communeId: z.int().positive().optional(),
  supervisorId: z.uuid().optional(),
});

const idList = (max) => z.array(z.uuid()).max(max).refine(unique, duplicates);
export const campaignPointsOfSaleSchema = z.strictObject({ pointOfSaleIds: idList(5000) });
export const campaignProductsSchema = z.strictObject({ productIds: idList(500) });

export const documentLabelSchema = z.strictObject({ label: text(120) });
export const fileVisibilityBodySchema = z.strictObject({ visibility: fileVisibilitySchema });

/** Web forms: localised budget input, empty description becomes null. */
const emptyToNull = (schema) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    schema,
  );
export const campaignFormSchema = createCampaignSchema.safeExtend({
  description: emptyToNull(campaignFields.description),
  budgetAmount: moneyInputSchema.optional(),
});
export const campaignEditFormSchema = updateCampaignSchema.safeExtend({
  description: emptyToNull(campaignFields.description),
  budgetAmount: moneyInputSchema.optional(),
});
