import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  USER_ROLES,
  can,
  isPermission,
  permissionsFor,
} from '../src/index.js';

// The permission catalog of Prompt 03, copied verbatim. The test parses it independently of the
// implementation, so a change to either side shows up as a failure.
const CATALOG = `
| Permission | director | general_manager | regional_manager | supervisor | animateur | client |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| \`campaign.read\` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| \`campaign.manage\` (create, edit, rules, files) | ✓ | | | | | |
| \`campaign.transition\` | ✓ | | | | | |
| \`campaign.rules.approve\` | ✓ | | | | | |
| \`org.user.read\` | ✓ | ✓ | ✓ | ✓ | | |
| \`org.user.manage\` | ✓ | | | | | |
| \`org.transfer\` | ✓ | ✓ | ✓ | | | |
| \`org.structure.manage\` (regions, points of sale) | ✓ | | | | | |
| \`org.pos.read\` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| \`reference.read\` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| \`catalog.read\` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| \`catalog.manage\` | ✓ | | | | | |
| \`assignment.read\` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| \`assignment.propose\` | ✓ | | ✓ | ✓ | | |
| \`assignment.approve\` (policy also checks campaign approver role) | ✓ | ✓ | ✓ | | | |
| \`attendance.read\` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| \`attendance.record\` | | | | | ✓ | |
| \`attendance.review\` | ✓ | | ✓ | ✓ | | |
| \`attendance.override\` | ✓ | | | | | |
| \`absence.record\` | ✓ | | ✓ | ✓ | | |
| \`absence.void\` | ✓ | | | | | |
| \`visit.read\` | ✓ | ✓ | ✓ | ✓ | | |
| \`visit.record\` | ✓ | | ✓ | ✓ | | |
| \`sale.read\` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| \`sale.record\` | | | | | ✓ | |
| \`sale.void\` | ✓ | | | ✓ | | |
| \`customer.read_personal\` | ✓ | | | ✓ | | |
| \`inventory.read\` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| \`inventory.stock_in\` | ✓ | | | | | |
| \`inventory.transfer\` | ✓ | | ✓ | ✓ | | |
| \`inventory.confirm\` | ✓ | | ✓ | ✓ | ✓ | |
| \`inventory.distribute\` | | | | | ✓ | |
| \`inventory.return\` | ✓ | | ✓ | ✓ | ✓ | |
| \`inventory.adjust.request\` | ✓ | | ✓ | ✓ | | |
| \`inventory.adjust.approve\` (policy: higher level than holder) | ✓ | ✓ | ✓ | | | |
| \`tombola.read\` | ✓ | ✓ | ✓ | ✓ | | ✓ |
| \`tombola.manage\` | ✓ | | | | | |
| \`tombola.draw\` | | | | | | ✓ |
| \`issue.read\` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| \`issue.create\` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| \`issue.manage\` | ✓ | ✓ | ✓ | ✓ | | |
| \`announcement.read\` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| \`announcement.publish\` | ✓ | ✓ | ✓ | ✓ | | |
| \`report.read\` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| \`report.export\` | ✓ | ✓ | ✓ | | | ✓ |
| \`file.upload\` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| \`file.share_with_client\` | ✓ | | | | | |
| \`audit.read\` | ✓ | | | | | |
`;

function parseCatalog(markdown) {
  const lines = markdown.trim().split('\n');
  const roles = lines[0]
    .split('|')
    .slice(2, -1)
    .map((cell) => cell.trim());
  const rows = lines.slice(2).map((line) => {
    const cells = line.split('|').slice(1, -1);
    const permission = cells[0].match(/`([^`]+)`/)[1];
    const granted = cells.slice(1).map((cell) => cell.trim() === '✓');
    return { permission, granted };
  });
  return { roles, rows };
}

const { roles, rows } = parseCatalog(CATALOG);

describe('permission catalog', () => {
  it('table columns are exactly the six roles', () => {
    expect(roles).toEqual([...USER_ROLES]);
  });

  it('lists exactly the permissions of the table, in order', () => {
    expect([...PERMISSIONS]).toEqual(rows.map((row) => row.permission));
  });

  const cases = rows.flatMap(({ permission, granted }) =>
    roles.map((role, index) => [role, permission, granted[index]]),
  );

  it.each(cases)('can(%s, %s) is %s', (role, permission, expected) => {
    expect(can(role, permission)).toBe(expected);
  });

  it('denies unknown roles and unknown permissions', () => {
    expect(can('admin', 'campaign.read')).toBe(false);
    expect(can(undefined, 'campaign.read')).toBe(false);
    expect(can('director', 'campaign.delete')).toBe(false);
    expect(can('director', 'toString')).toBe(false);
    expect(can('constructor', 'campaign.read')).toBe(false);
    expect(isPermission('campaign.read')).toBe(true);
    expect(isPermission('campaign.delete')).toBe(false);
  });

  it('exposes frozen data', () => {
    expect(Object.isFrozen(PERMISSIONS)).toBe(true);
    expect(Object.isFrozen(ROLE_PERMISSIONS)).toBe(true);
    for (const role of USER_ROLES) expect(Object.isFrozen(ROLE_PERMISSIONS[role])).toBe(true);
    expect(permissionsFor('client')).toEqual([
      'campaign.read',
      'reference.read',
      'tombola.read',
      'tombola.draw',
      'report.read',
      'report.export',
    ]);
    expect(permissionsFor('nobody')).toEqual([]);
  });
});
