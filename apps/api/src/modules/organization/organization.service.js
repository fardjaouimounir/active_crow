import { businessDate } from '../../core/time/clock.js';
import { readTree } from './hierarchy.repository.js';

async function tree(scope, at = businessDate()) {
  const rows = await readTree(scope, at);
  const nodes = new Map(rows.map((row) => [row.id, { ...row, children: [] }]));
  const roots = [];
  for (const node of nodes.values()) {
    const manager = nodes.get(node.managerId);
    if (manager) manager.children.push(node);
    else roots.push({ ...node, managerId: null });
  }
  return roots;
}

export const organizationService = Object.freeze({ tree });
