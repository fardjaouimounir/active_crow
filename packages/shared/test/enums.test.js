import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DB_ENUMS, USER_ROLES, userRoleSchema } from '../src/index.js';

const designDoc = fileURLToPath(new URL('../../../docs/04-database-design.md', import.meta.url));

/**
 * Reads the "Enums" table of the database design document.
 * Rows look like: | `user_role` | `director`، `general_manager`، … |
 * @returns {Record<string, string[]>}
 */
function readDocumentedEnums() {
  const markdown = readFileSync(designDoc, 'utf8');
  const section = markdown.split(/^## Enums\s*$/m)[1].split(/^## /m)[0];
  const enums = {};
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^\|\s*`([a-z_]+)`\s*\|(.+)\|\s*$/);
    if (!match) continue;
    enums[match[1]] = [...match[2].matchAll(/`([a-z_]+)`/g)].map((value) => value[1]);
  }
  return enums;
}

describe('shared enums', () => {
  const documented = readDocumentedEnums();

  it('covers exactly the enums listed in docs/04-database-design.md', () => {
    expect(Object.keys(documented).length).toBeGreaterThan(0);
    expect(Object.keys(DB_ENUMS).sort()).toEqual(Object.keys(documented).sort());
  });

  it.each(Object.entries(documented))('%s has the documented values in order', (name, values) => {
    expect([...DB_ENUMS[name]]).toEqual(values);
  });

  it('exposes frozen arrays and matching Zod schemas', () => {
    expect(Object.isFrozen(USER_ROLES)).toBe(true);
    expect(userRoleSchema.parse('animateur')).toBe('animateur');
    expect(userRoleSchema.safeParse('admin').success).toBe(false);
  });
});
