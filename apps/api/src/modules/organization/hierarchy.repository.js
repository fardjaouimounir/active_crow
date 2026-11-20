import { Prisma, prisma } from '../../db/client.js';

/** Returns descendants whose reporting lines are effective on the given date. */
export async function descendantIds(db, { agencyId, userId }, at, maxDepth = null) {
  const rows = await db.$queryRaw`
    ${effectiveTree(agencyId, userId, at, maxDepth)}
    SELECT DISTINCT user_id AS id FROM tree
`;
  return rows.map(({ id }) => id);
}

function effectiveTree(agencyId, userId, at, maxDepth) {
  return Prisma.sql`
    WITH RECURSIVE tree (user_id, depth, path) AS (
      SELECT rl.user_id, 1, ARRAY[rl.manager_id, rl.user_id]
      FROM reporting_lines rl
      WHERE rl.agency_id = ${agencyId}::uuid
        AND rl.manager_id = ${userId}::uuid
        AND rl.valid_from <= ${at}::date
        AND (rl.valid_to IS NULL OR rl.valid_to > ${at}::date)
      UNION ALL
      SELECT rl.user_id, tree.depth + 1, tree.path || rl.user_id
      FROM reporting_lines rl
      JOIN tree ON rl.manager_id = tree.user_id
      WHERE (${maxDepth}::int IS NULL OR tree.depth < ${maxDepth}::int)
        AND rl.user_id <> ALL(tree.path)
        AND rl.agency_id = ${agencyId}::uuid
        AND rl.valid_from <= ${at}::date
        AND (rl.valid_to IS NULL OR rl.valid_to > ${at}::date)
    )`;
}

/** Loads the effective organization and its visible edges together. */
export function readTree(scope, at) {
  const { agencyId, userId, level } = scope;
  if (!agencyId || !['agency', 'regional', 'supervisor'].includes(level)) {
    throw new Error('An organization scope is required');
  }
  const tree =
    level === 'agency'
      ? Prisma.empty
      : effectiveTree(agencyId, userId, at, level === 'supervisor' ? 1 : 3);
  const visible =
    level === 'agency'
      ? Prisma.empty
      : Prisma.sql`AND (u.id = ${userId}::uuid OR u.id IN (SELECT user_id FROM tree))`;
  return prisma.$queryRaw`
    ${tree}
    SELECT u.id, u.full_name AS "fullName", u.role, u.status, rl.manager_id AS "managerId"
    FROM users u
    LEFT JOIN reporting_lines rl ON rl.user_id = u.id AND rl.agency_id = u.agency_id
      AND rl.valid_from <= ${at}::date
      AND (rl.valid_to IS NULL OR rl.valid_to > ${at}::date)
    WHERE u.agency_id = ${agencyId}::uuid AND u.role <> 'client'
      AND (rl.id IS NOT NULL OR u.role = 'director' OR u.id = ${userId ?? null}::uuid)
      ${visible}
    ORDER BY u.full_name, u.id`;
}
