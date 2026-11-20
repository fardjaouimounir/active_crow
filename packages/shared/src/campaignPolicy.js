// What may be edited in which campaign status (Prompt 07 §E). Pure, so the API enforces it and the
// web app hides or disables the same controls.

/** @typedef {'details' | 'startDate' | 'endDate' | 'approver' | 'coverage' | 'products' | 'documents' | 'ruleSet'} EditArea */

export const EDIT_AREAS = Object.freeze([
  'details',
  'startDate',
  'endDate',
  'approver',
  'coverage',
  'products',
  'documents',
  'ruleSet',
]);

const EARLY = new Set(['draft', 'planning', 'assigned']);
const LIVE = new Set(['active', 'suspended']);

/**
 * @param {{ status: string, endDate?: string }} campaign
 * @param {EditArea} area
 * @param {{ endDate?: string, today?: string, removing?: boolean }} [change]
 *   `endDate` + `today`: the new end date (live campaigns may only extend it, never before today);
 *   `removing`: the change removes products (not allowed once the campaign is live).
 * @returns {{ allowed: true } | { allowed: false, code: 'FIELD_NOT_EDITABLE_IN_STATUS' | 'PRODUCT_REMOVAL_LOCKED', area: EditArea }}
 */
export function canEdit(campaign, area, change = {}) {
  const { status } = campaign;
  const deny = (code = 'FIELD_NOT_EDITABLE_IN_STATUS') => ({ allowed: false, code, area });
  const early = EARLY.has(status);
  const live = LIVE.has(status);
  switch (area) {
    case 'details':
    case 'coverage':
    case 'ruleSet':
      return early || live ? { allowed: true } : deny();
    case 'startDate':
    case 'approver':
      return early ? { allowed: true } : deny();
    case 'endDate': {
      if (early) return { allowed: true };
      if (!live) return deny();
      if (change.endDate === undefined) return { allowed: true };
      const extending =
        change.endDate >= (campaign.endDate ?? '') && change.endDate >= (change.today ?? '');
      return extending ? { allowed: true } : deny();
    }
    case 'products':
      if (early) return { allowed: true };
      if (!live) return deny();
      return change.removing ? deny('PRODUCT_REMOVAL_LOCKED') : { allowed: true };
    case 'documents':
      return early || live || status === 'completed' ? { allowed: true } : deny();
    default:
      return deny();
  }
}
