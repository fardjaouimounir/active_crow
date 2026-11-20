// Enums from docs/04-database-design.md, section "Enums".
// Each enum is exported as a frozen array (the source of truth in JS) and a Zod enum schema.
// Order matches the design document and must stay in sync with the PostgreSQL enum types.
import { z } from 'zod';

/** @param {readonly string[]} values */
const freeze = (values) => Object.freeze([...values]);

export const USER_ROLES = freeze([
  'director',
  'general_manager',
  'regional_manager',
  'supervisor',
  'animateur',
  'client',
]);
export const userRoleSchema = z.enum(USER_ROLES);

export const USER_STATUSES = freeze(['active', 'suspended', 'left']);
export const userStatusSchema = z.enum(USER_STATUSES);

export const CAMPAIGN_STATUSES = freeze([
  'draft',
  'planning',
  'assigned',
  'active',
  'suspended',
  'completed',
  'closed',
  'cancelled',
]);
export const campaignStatusSchema = z.enum(CAMPAIGN_STATUSES);

export const RULE_SET_STATUSES = freeze(['draft', 'approved', 'superseded']);
export const ruleSetStatusSchema = z.enum(RULE_SET_STATUSES);

export const RULE_TYPES = freeze([
  'attendance',
  'uniform',
  'sales_target',
  'sampling_target',
  'customer_fields',
  'daily_report',
]);
export const ruleTypeSchema = z.enum(RULE_TYPES);

export const PROMOTION_TYPES = freeze(['gift_with_purchase', 'tiered_gift']);
export const promotionTypeSchema = z.enum(PROMOTION_TYPES);

export const CAMPAIGN_STAFF_ROLES = freeze(['regional_manager', 'supervisor']);
export const campaignStaffRoleSchema = z.enum(CAMPAIGN_STAFF_ROLES);

export const ASSIGNMENT_STATUSES = freeze(['proposed', 'approved', 'rejected', 'cancelled']);
export const assignmentStatusSchema = z.enum(ASSIGNMENT_STATUSES);

export const ATTENDANCE_STATUSES = freeze(['pending', 'verified', 'rejected']);
export const attendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);

export const ABSENCE_TYPES = freeze(['justified', 'unjustified']);
export const absenceTypeSchema = z.enum(ABSENCE_TYPES);

export const SALE_STATUSES = freeze(['recorded', 'voided']);
export const saleStatusSchema = z.enum(SALE_STATUSES);

export const ENTITLEMENT_STATUSES = freeze(['pending', 'distributed', 'undelivered', 'cancelled']);
export const entitlementStatusSchema = z.enum(ENTITLEMENT_STATUSES);

export const STOCK_ITEM_KINDS = freeze(['gift', 'sample']);
export const stockItemKindSchema = z.enum(STOCK_ITEM_KINDS);

export const STOCK_LOCATION_KINDS = freeze([
  'external',
  'warehouse',
  'holder',
  'in_transit',
  'customers',
  'losses',
]);
export const stockLocationKindSchema = z.enum(STOCK_LOCATION_KINDS);

export const STOCK_MOVEMENT_TYPES = freeze([
  'stock_in',
  'transfer',
  'distribution',
  'return',
  'adjustment',
]);
export const stockMovementTypeSchema = z.enum(STOCK_MOVEMENT_TYPES);

export const STOCK_MOVEMENT_STATUSES = freeze([
  'posted',
  'pending',
  'confirmed',
  'disputed',
  'cancelled',
  'pending_approval',
  'rejected',
]);
export const stockMovementStatusSchema = z.enum(STOCK_MOVEMENT_STATUSES);

export const TOMBOLA_STATUSES = freeze(['open', 'closed', 'drawn']);
export const tombolaStatusSchema = z.enum(TOMBOLA_STATUSES);

export const TOMBOLA_ENTRY_STATUSES = freeze(['valid', 'excluded']);
export const tombolaEntryStatusSchema = z.enum(TOMBOLA_ENTRY_STATUSES);

export const PRIZE_DELIVERY_STATUSES = freeze(['pending', 'delivered', 'unreachable']);
export const prizeDeliveryStatusSchema = z.enum(PRIZE_DELIVERY_STATUSES);

export const ISSUE_STATUSES = freeze(['open', 'in_progress', 'resolved', 'closed']);
export const issueStatusSchema = z.enum(ISSUE_STATUSES);

export const FILE_VISIBILITIES = freeze(['internal', 'client_visible']);
export const fileVisibilitySchema = z.enum(FILE_VISIBILITIES);

export const ACTOR_TYPES = freeze(['user', 'system', 'ai_service']);
export const actorTypeSchema = z.enum(ACTOR_TYPES);

export const AI_SUGGESTION_STATUSES = freeze(['pending_review', 'accepted', 'rejected']);
export const aiSuggestionStatusSchema = z.enum(AI_SUGGESTION_STATUSES);

/** PostgreSQL enum type name → allowed values. */
export const DB_ENUMS = Object.freeze({
  user_role: USER_ROLES,
  user_status: USER_STATUSES,
  campaign_status: CAMPAIGN_STATUSES,
  rule_set_status: RULE_SET_STATUSES,
  rule_type: RULE_TYPES,
  promotion_type: PROMOTION_TYPES,
  campaign_staff_role: CAMPAIGN_STAFF_ROLES,
  assignment_status: ASSIGNMENT_STATUSES,
  attendance_status: ATTENDANCE_STATUSES,
  absence_type: ABSENCE_TYPES,
  sale_status: SALE_STATUSES,
  entitlement_status: ENTITLEMENT_STATUSES,
  stock_item_kind: STOCK_ITEM_KINDS,
  stock_location_kind: STOCK_LOCATION_KINDS,
  stock_movement_type: STOCK_MOVEMENT_TYPES,
  stock_movement_status: STOCK_MOVEMENT_STATUSES,
  tombola_status: TOMBOLA_STATUSES,
  tombola_entry_status: TOMBOLA_ENTRY_STATUSES,
  prize_delivery_status: PRIZE_DELIVERY_STATUSES,
  issue_status: ISSUE_STATUSES,
  file_visibility: FILE_VISIBILITIES,
  actor_type: ACTOR_TYPES,
  ai_suggestion_status: AI_SUGGESTION_STATUSES,
});
