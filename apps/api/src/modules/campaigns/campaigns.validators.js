import { CAMPAIGN_STATUSES } from '@fieldflow/shared';
import { z } from 'zod';

export {
  createCampaignSchema as createCampaign,
  updateCampaignSchema as updateCampaign,
  campaignWilayasSchema as wilayas,
  campaignStaffSchema as staff,
  campaignPointsOfSaleSchema as pointsOfSale,
  campaignProductsSchema as products,
  documentLabelSchema as documentLabel,
  staffQuotaSchema as staffQuota,
  teamAnimateurSchema as teamAnimateur,
  newTeamAnimateurSchema as newTeamAnimateur,
} from '@fieldflow/shared';

const integer = (max) => z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(1).max(max));

export const empty = z.strictObject({});
export const params = z.strictObject({ id: z.uuid() });
export const staffParams = z.strictObject({ id: z.uuid(), staffId: z.uuid() });
export const teamParams = z.strictObject({ id: z.uuid(), animateurId: z.uuid() });
export const documentParams = z.strictObject({ id: z.uuid(), documentId: z.uuid() });

export const campaignList = z
  .strictObject({
    status: z.enum(CAMPAIGN_STATUSES).optional(),
    clientId: z.uuid().optional(),
    wilayaId: integer(69).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    q: z.string().trim().max(200).optional(),
    sort: z
      .enum(['startDate', 'name', 'code', 'createdAt'].flatMap((f) => [f + ':asc', f + ':desc']))
      .default('startDate:desc'),
    page: integer(1000000).default(1),
    pageSize: integer(100).default(25),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    path: ['to'],
    message: '`to` must be on or after `from`',
  });
