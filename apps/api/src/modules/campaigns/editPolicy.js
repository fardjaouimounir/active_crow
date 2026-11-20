// Central edit policy for every campaign write (Prompts 06–07): the pure matrix lives in
// @fieldflow/shared (the web app uses the same one); this module turns a denial into the 422.
import { canEdit } from '@fieldflow/shared';
import { AppError } from '../../core/errors/index.js';

/**
 * @param {{ status: string, endDate?: string }} campaign a locked campaign row or detail
 * @param {import('@fieldflow/shared').EditArea} area
 * @param {Parameters<typeof canEdit>[2]} [change]
 * @throws {AppError} 422 FIELD_NOT_EDITABLE_IN_STATUS (or PRODUCT_REMOVAL_LOCKED) with `details.area`
 */
export function assertEditable(campaign, area, change) {
  const decision = canEdit(campaign, area, change);
  if (decision.allowed) return;
  throw new AppError({
    status: 422,
    code: decision.code,
    message:
      decision.code === 'PRODUCT_REMOVAL_LOCKED'
        ? 'Products cannot be removed from a campaign that is running'
        : 'This cannot be edited while the campaign is ' + campaign.status,
    details: { area, status: campaign.status },
  });
}
