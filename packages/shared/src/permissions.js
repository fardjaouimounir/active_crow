// Permission catalog and role → permission map (Prompt 03, section 3). The single source used by the
// API (requirePermission) and the web app (useCan). Extend only when a prompt explicitly says so.
import { USER_ROLES } from './enums.js';

/** Every permission, in catalog order. */
export const PERMISSIONS = Object.freeze([
  'campaign.read',
  'campaign.manage',
  'campaign.transition',
  'campaign.rules.approve',
  'org.user.read',
  'org.user.manage',
  'org.transfer',
  'org.structure.manage',
  'org.pos.read',
  'reference.read',
  'catalog.read',
  'catalog.manage',
  'assignment.read',
  'assignment.propose',
  'assignment.approve',
  'attendance.read',
  'attendance.record',
  'attendance.review',
  'attendance.override',
  'absence.record',
  'absence.void',
  'visit.read',
  'visit.record',
  'sale.read',
  'sale.record',
  'sale.void',
  'customer.read_personal',
  'inventory.read',
  'inventory.stock_in',
  'inventory.transfer',
  'inventory.confirm',
  'inventory.distribute',
  'inventory.return',
  'inventory.adjust.request',
  'inventory.adjust.approve',
  'tombola.read',
  'tombola.manage',
  'tombola.draw',
  'issue.read',
  'issue.create',
  'issue.manage',
  'announcement.read',
  'announcement.publish',
  'reports.read',
  'reports.export',
  'report.read',
  'report.export',
  'file.upload',
  'file.share_with_client',
  'audit.read',
  'ai.request',
  'ai.review',
]);

const D = 'director';
const GM = 'general_manager';
const RM = 'regional_manager';
const SV = 'supervisor';
const AN = 'animateur';
const CL = 'client';

/** Permission → roles holding it (one row of the catalog table each). */
const GRANTS = {
  'campaign.read': [D, GM, RM, SV, AN, CL],
  'campaign.manage': [D],
  'campaign.transition': [D],
  'campaign.rules.approve': [D],
  'org.user.read': [D, GM, RM, SV],
  'org.user.manage': [D],
  'org.transfer': [D, GM, RM],
  'org.structure.manage': [D],
  'reference.read': [D, GM, RM, SV, AN, CL],
  'org.pos.read': [D, GM, RM, SV, AN],
  'catalog.read': [D, GM, RM, SV, AN],
  'catalog.manage': [D],
  'assignment.read': [D, GM, RM, SV, AN],
  'assignment.propose': [D, RM, SV],
  'assignment.approve': [D, GM, RM],
  'attendance.read': [D, GM, RM, SV, AN],
  'attendance.record': [AN],
  'attendance.review': [D, RM, SV],
  'attendance.override': [D],
  'absence.record': [D, RM, SV],
  'absence.void': [D],
  'visit.read': [D, GM, RM, SV],
  'visit.record': [D, RM, SV],
  'sale.read': [D, GM, RM, SV, AN],
  'sale.record': [AN],
  'sale.void': [D, RM, SV],
  'customer.read_personal': [D, GM],
  'inventory.read': [D, GM, RM, SV, AN],
  'inventory.stock_in': [D],
  'inventory.transfer': [D, RM, SV],
  'inventory.confirm': [D, RM, SV, AN],
  'inventory.distribute': [AN],
  'inventory.return': [D, RM, SV, AN],
  'inventory.adjust.request': [D, RM, SV],
  'inventory.adjust.approve': [D, GM, RM],
  'tombola.read': [D, GM, RM, SV, CL],
  'tombola.manage': [D],
  'tombola.draw': [CL],
  'issue.read': [D, GM, RM, SV, AN],
  'issue.create': [D, GM, RM, SV, AN],
  'issue.manage': [D, GM, RM, SV],
  'announcement.read': [D, GM, RM, SV, AN],
  'announcement.publish': [D, GM, RM, SV],
  'report.read': [D, GM, RM, SV, AN, CL],
  'reports.read': [D, GM, RM, SV, AN],
  'reports.export': [D, GM, RM, SV],
  'report.export': [D, GM, RM, CL],
  'file.upload': [D, GM, RM, SV, AN],
  'file.share_with_client': [D],
  'audit.read': [D],
  'ai.request': [D, GM, RM, SV],
  'ai.review': [D, GM, RM],
};

/** Role → frozen list of its permissions, in catalog order. */
export const ROLE_PERMISSIONS = Object.freeze(
  Object.fromEntries(
    USER_ROLES.map((role) => [
      role,
      Object.freeze(PERMISSIONS.filter((permission) => GRANTS[permission].includes(role))),
    ]),
  ),
);

const PERMISSION_SET = new Set(PERMISSIONS);

/** @param {string} permission */
export function isPermission(permission) {
  return PERMISSION_SET.has(permission);
}

/**
 * Whether `role` holds `permission`. Unknown roles and unknown permissions are denied.
 * @param {string | null | undefined} role
 * @param {string} permission
 */
export function can(role, permission) {
  return Object.hasOwn(ROLE_PERMISSIONS, role ?? '') && ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * @param {string | null | undefined} role
 * @returns {readonly string[]}
 */
export function permissionsFor(role) {
  return Object.hasOwn(ROLE_PERMISSIONS, role ?? '') ? ROLE_PERMISSIONS[role] : Object.freeze([]);
}
