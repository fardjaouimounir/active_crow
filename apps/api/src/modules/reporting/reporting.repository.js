import { Prisma } from '../../db/client.js';
import { REPORTING_TREE_MAX_DEPTH, assertScope } from '../../core/authz/scopeFilters.js';

const whereIds = (column, values, type = 'uuid') => {
  if (!values) return Prisma.empty;
  const members = Prisma.join(
    values.map((value) =>
      type === 'integer' ? Prisma.sql`${value}::integer` : Prisma.sql`${value}::uuid`,
    ),
  );
  return Prisma.sql`AND ${column} IN (${members})`;
};

const dimensions = {
  day: Prisma.sql`work_date::text`,
  wilaya: Prisma.sql`wilaya_id::text`,
  region: Prisma.sql`coalesce(region_id::text, '')`,
  point_of_sale: Prisma.sql`point_of_sale_id::text`,
  supervisor: Prisma.sql`supervisor_id::text`,
  animateur: Prisma.sql`animateur_id::text`,
  campaign: Prisma.sql`campaign_id::text`,
  product: Prisma.sql`product_id::text`,
};

function teamIntervals({ agencyId, userId, level }) {
  return Prisma.sql`team AS (
    SELECT ${userId ?? null}::uuid AS user_id, '-infinity'::date AS starts,
      'infinity'::date AS ends, 0 AS depth
    WHERE ${level} = 'regional'
    UNION ALL
    SELECT l.user_id, greatest(t.starts, l.valid_from),
      least(t.ends, coalesce(l.valid_to, 'infinity'::date)), t.depth + 1
    FROM team t JOIN reporting_lines l ON l.agency_id = ${agencyId}::uuid AND l.manager_id = t.user_id
    WHERE t.depth < ${REPORTING_TREE_MAX_DEPTH} AND l.valid_from < t.ends
      AND coalesce(l.valid_to, 'infinity'::date) > t.starts
  )`;
}

const regionalMember = (row) => Prisma.sql`EXISTS (
  SELECT 1 FROM team WHERE team.user_id = ${row}.supervisor_id
    AND team.starts <= ${row}.work_date AND team.ends > ${row}.work_date
)`;

function operationScope(scope, row) {
  if (scope.level === 'agency') return Prisma.empty;
  if (scope.level === 'self') return Prisma.sql`AND ${row}.animateur_id = ${scope.userId}::uuid`;
  if (scope.level === 'supervisor')
    return Prisma.sql`AND ${row}.supervisor_id = ${scope.userId}::uuid`;
  if (scope.level === 'regional') return Prisma.sql`AND ${regionalMember(row)}`;
  return Prisma.sql`AND false`;
}

function visitInRegion(scope) {
  // A separately staffed point remains visible even when the visitor is outside the reporting tree.
  return Prisma.sql`EXISTS (
    SELECT 1 FROM campaign_staff staff JOIN campaign_points_of_sale pos
      ON pos.campaign_id = staff.campaign_id AND pos.agency_id = staff.agency_id
    WHERE staff.agency_id = v.agency_id AND staff.campaign_id = v.campaign_id
      AND staff.wilaya_id = p.wilaya_id AND staff.user_id = ${scope.userId}::uuid
      AND staff.role = 'regional_manager' AND pos.point_of_sale_id = v.point_of_sale_id
      AND p.deleted_at IS NULL
  )`;
}

function facets(filters, row, withAnimateur = true) {
  return Prisma.sql`
    ${whereIds(Prisma.sql`p.wilaya_id`, filters.wilayaIds, 'integer')}
    ${whereIds(Prisma.sql`rw.region_id`, filters.regionIds)}
    ${whereIds(Prisma.sql`${row}.point_of_sale_id`, filters.pointOfSaleIds)}
    ${whereIds(Prisma.sql`${row}.supervisor_id`, filters.supervisorIds)}
    ${withAnimateur ? whereIds(Prisma.sql`${row}.animateur_id`, filters.animateurIds) : Prisma.empty}`;
}

const location = (row) => Prisma.sql`
  JOIN points_of_sale p ON p.id = ${row}.point_of_sale_id AND p.agency_id = ${row}.agency_id
  LEFT JOIN region_wilayas rw ON rw.wilaya_id = p.wilaya_id AND rw.agency_id = p.agency_id`;

export async function aggregate(db, scope, filters, dimension, instant) {
  assertScope(scope);
  const { agencyId, userId } = scope;
  const { from, to } = filters;
  const elapsedTo = Prisma.sql`least(${to}::date, (${instant}::timestamptz AT TIME ZONE 'Africa/Algiers')::date)`;
  const key = dimensions[dimension] ?? Prisma.sql`''::text`;
  const visitsKey = dimension === 'animateur' ? Prisma.sql`observed_animateur_id::text` : key;
  const salesSource =
    dimension === 'product'
      ? Prisma.sql`SELECT s.*, si.product_id, si.quantity AS units
        FROM visible_sales s JOIN sale_items si ON si.sale_id = s.id`
      : Prisma.sql`SELECT s.*, i.units FROM visible_sales s
        LEFT JOIN (
          SELECT si.sale_id, sum(si.quantity) AS units FROM sale_items si
          JOIN visible_sales matched ON matched.id = si.sale_id AND matched.status = 'recorded'
          GROUP BY si.sale_id
        ) i ON i.sale_id = s.id`;
  const otherKey = dimension === 'product' ? Prisma.sql`NULL::text` : key;
  const visitBranch =
    dimension === 'animateur'
      ? Prisma.sql`CROSS JOIN LATERAL unnest(v.observed_animateur_ids) AS obs(observed_animateur_id)`
      : Prisma.empty;
  const visitsScope =
    scope.level === 'self'
      ? Prisma.sql`AND ${userId}::uuid = ANY(v.observed_animateur_ids)`
      : scope.level === 'regional'
        ? Prisma.sql`AND (
          ${regionalMember(Prisma.sql`v`)}
          OR ${visitInRegion(scope)}
        )`
        : operationScope(scope, Prisma.sql`v`);
  const targetSource =
    dimension === 'product'
      ? Prisma.sql`SELECT r.*, (item->>'productId')::uuid AS product_id, (item->>'dailyUnits')::integer AS sales_target,
        NULL::integer AS sampling_target FROM rule_days r
        CROSS JOIN LATERAL jsonb_array_elements(r.target_sale->'perProduct') item`
      : Prisma.sql`SELECT r.*, (target_sale->>'dailyUnitsPerAnimateur')::integer AS sales_target,
      (target_sample->>'dailySamplesPerAnimateur')::integer AS sampling_target FROM rule_days r`;
  const completion =
    dimension === 'day'
      ? Prisma.sql`SELECT work_date::text AS bucket, "plannedDays", "elapsedDays" FROM (
        SELECT work_date, sum(day_count) OVER () AS "plannedDays",
          sum(day_count) FILTER (WHERE work_date <= ${elapsedTo})
            OVER (ORDER BY work_date) AS "elapsedDays"
        FROM (SELECT work_date, count(DISTINCT campaign_id) AS day_count FROM completion_schedule GROUP BY work_date) days
      ) cumulative WHERE work_date BETWEEN ${from}::date AND ${to}::date`
      : Prisma.sql`SELECT ${otherKey} AS bucket, count(DISTINCT (campaign_id, work_date)) AS "plannedDays",
      count(DISTINCT (campaign_id, work_date)) FILTER (WHERE work_date <= ${elapsedTo}) AS "elapsedDays"
      FROM completion_schedule GROUP BY bucket`;
  return db.$queryRaw`
    WITH RECURSIVE
    ${teamIntervals(scope)}, selected_campaigns AS (
      SELECT c.id, c.agency_id, c.start_date, c.end_date, c.status
      FROM campaigns c WHERE c.agency_id = ${agencyId}::uuid
      ${whereIds(Prisma.sql`c.id`, filters.campaignIds)}
      ${whereIds(Prisma.sql`c.client_id`, filters.clientId ? [filters.clientId] : undefined)}
    ), schedule AS (
      SELECT a.id, a.campaign_id, a.animateur_id, a.supervisor_id, a.point_of_sale_id,
        d::date AS work_date, p.wilaya_id, rw.region_id
      FROM assignments a JOIN selected_campaigns c ON c.id = a.campaign_id
      ${location(Prisma.sql`a`)}
      CROSS JOIN LATERAL generate_series(greatest(a.start_date, c.start_date)::timestamp,
        least(a.end_date, c.end_date)::timestamp, interval '1 day') d
      WHERE a.agency_id = ${agencyId}::uuid AND a.status = 'approved'
        AND c.start_date <= ${to}::date AND c.end_date >= ${from}::date
        AND (coalesce(cardinality(a.work_days), 0) = 0 OR extract(isodow FROM d)::int = ANY(a.work_days))
      ${facets(filters, Prisma.sql`a`)}
    ), visible_schedule AS (
      SELECT a.* FROM schedule a WHERE true ${operationScope(scope, Prisma.sql`a`)}
    ), visible_days AS (
      SELECT d.*, least(${instant}::timestamptz,
        ((d.work_date::timestamp + interval '1 day') AT TIME ZONE 'Africa/Algiers') - interval '1 millisecond') AS cutoff
      FROM visible_schedule d WHERE d.work_date BETWEEN ${from}::date AND ${to}::date
    ), completion_schedule AS (
      SELECT a.* FROM visible_schedule a
      WHERE a.campaign_id IN (SELECT DISTINCT campaign_id FROM visible_days)
    ), effective AS (
      SELECT distinct_days.campaign_id, distinct_days.work_date, version.id AS rule_set_id
      FROM (SELECT DISTINCT campaign_id, work_date, cutoff FROM visible_days
        WHERE work_date <= (${instant}::timestamptz AT TIME ZONE 'Africa/Algiers')::date) distinct_days
      JOIN selected_campaigns c ON c.id = distinct_days.campaign_id
      LEFT JOIN LATERAL (
        SELECT to_status FROM campaign_status_history h WHERE h.campaign_id = c.id AND h.agency_id = c.agency_id
          AND h.created_at <= distinct_days.cutoff ORDER BY h.created_at DESC, h.id DESC LIMIT 1
      ) latest ON true
      LEFT JOIN LATERAL (
        SELECT from_status FROM campaign_status_history h WHERE h.campaign_id = c.id AND h.agency_id = c.agency_id
        ORDER BY h.created_at, h.id LIMIT 1
      ) first ON latest.to_status IS NULL
      JOIN LATERAL (
        SELECT id FROM rule_sets rs WHERE rs.campaign_id = c.id AND rs.agency_id = c.agency_id
          AND rs.status IN ('approved', 'superseded') AND rs.effective_from <= distinct_days.cutoff
        ORDER BY rs.effective_from DESC, rs.version DESC LIMIT 1
      ) version ON true
      WHERE coalesce(latest.to_status, first.from_status, c.status) = 'active'
    ), rule_days AS (
      SELECT d.*, sale.config AS target_sale, sample.config AS target_sample
      FROM visible_days d JOIN effective e USING (campaign_id, work_date)
      LEFT JOIN campaign_rules sale ON sale.rule_set_id = e.rule_set_id AND sale.rule_type = 'sales_target'
      LEFT JOIN campaign_rules sample ON sample.rule_set_id = e.rule_set_id AND sample.rule_type = 'sampling_target'
    ), checkpoint_rules AS MATERIALIZED (
      SELECT e.campaign_id, e.work_date, checkpoint->>'code' AS checkpoint
      FROM effective e JOIN campaign_rules rule ON rule.rule_set_id = e.rule_set_id AND rule.rule_type = 'attendance'
      CROSS JOIN LATERAL jsonb_array_elements(rule.config->'checkpoints') checkpoint
    ), attendance_rows AS (
      SELECT a.id, a.agency_id, a.campaign_id, a.assignment_id, a.animateur_id, a.point_of_sale_id,
        a.work_date, a.checkpoint, a.rule_set_id, a.status, a.is_late, a.recorded_at, r.supervisor_id
      FROM attendance_records a
      JOIN selected_campaigns c ON c.id = a.campaign_id
      JOIN assignments r ON r.id = a.assignment_id AND r.agency_id = a.agency_id
      WHERE a.agency_id = ${agencyId}::uuid AND a.work_date BETWEEN ${from}::date AND ${to}::date
    ), scoped_attendance AS (
      SELECT a.*, p.wilaya_id, rw.region_id FROM attendance_rows a ${location(Prisma.sql`a`)}
      WHERE true ${operationScope(scope, Prisma.sql`a`)} ${facets(filters, Prisma.sql`a`)}
    ), slots AS (
      SELECT ${otherKey} AS bucket, work_date, d.id, r.checkpoint
      FROM visible_days d JOIN checkpoint_rules r USING (campaign_id, work_date)
    ), saved_slots AS (
      SELECT ${otherKey} AS bucket, work_date, id, assignment_id, checkpoint, status, rule_set_id
      FROM scoped_attendance
    ), attendance_stats AS (
      SELECT coalesce(s.bucket, a.bucket) AS bucket,
        count(*) FILTER (WHERE s.id IS NOT NULL AND ab.type IS DISTINCT FROM 'justified') AS "expectedSlots",
        count(*) FILTER (WHERE s.id IS NOT NULL AND a.status = 'verified' AND ab.type IS DISTINCT FROM 'justified') AS "verifiedExpected",
        count(*) FILTER (WHERE s.id IS NOT NULL AND a.status = 'pending' AND ab.type IS DISTINCT FROM 'justified') AS "pendingExpected",
        count(*) FILTER (WHERE a.status = 'verified') AS verified,
        count(*) FILTER (WHERE a.status = 'pending') AS pending,
        count(*) FILTER (WHERE a.status = 'rejected' AND ab.id IS NULL) AS rejected,
        count(*) FILTER (WHERE a.id IS NULL AND ab.id IS NULL) AS "notSent",
        count(*) FILTER (WHERE (a.id IS NULL OR a.status = 'rejected') AND ab.type = 'justified') AS "absentJustified",
        count(*) FILTER (WHERE (a.id IS NULL OR a.status = 'rejected') AND ab.type = 'unjustified') AS "absentUnjustified"
      FROM slots s FULL JOIN saved_slots a ON a.assignment_id = s.id AND a.work_date = s.work_date
        AND a.checkpoint = s.checkpoint
      LEFT JOIN absences ab ON ab.assignment_id = coalesce(s.id, a.assignment_id)
        AND ab.work_date = coalesce(s.work_date, a.work_date)
        AND ab.voided_at IS NULL AND ab.agency_id = ${agencyId}::uuid
      WHERE s.id IS NOT NULL OR EXISTS (
        SELECT 1 FROM campaign_rules r WHERE r.rule_set_id = a.rule_set_id AND r.rule_type = 'attendance'
          AND r.config->'checkpoints' @> jsonb_build_array(jsonb_build_object('code', a.checkpoint))
      )
      GROUP BY coalesce(s.bucket, a.bucket)
    ), late_stats AS (
      SELECT ${otherKey} AS bucket, count(*) AS "attendanceRecords", count(*) FILTER (WHERE is_late) AS "lateRecords",
        count(*) FILTER (WHERE status = 'pending' AND recorded_at < ${instant}::timestamptz - interval '24 hours') AS "oldPending"
      FROM scoped_attendance GROUP BY bucket
    ), visible_sales AS (
      SELECT s.id, s.agency_id, s.campaign_id, s.work_date, s.animateur_id, s.supervisor_id,
        s.point_of_sale_id, s.customer_id, s.status, p.wilaya_id, rw.region_id FROM sales s
      JOIN selected_campaigns c ON c.id = s.campaign_id ${location(Prisma.sql`s`)}
      WHERE s.agency_id = ${agencyId}::uuid AND s.work_date BETWEEN ${from}::date AND ${to}::date
      ${facets(filters, Prisma.sql`s`)} ${operationScope(scope, Prisma.sql`s`)}
    ), sales_stats AS (
      SELECT ${key} AS bucket, count(*) AS "salesCount", sum(units) AS "salesUnits",
        count(DISTINCT customer_id) AS "identifiedBuyers",
        count(*) FILTER (WHERE customer_id IS NULL) AS "anonymousSales"
      FROM (${salesSource}) grouped_sales WHERE status = 'recorded' GROUP BY bucket
    ), gift_rows AS (
      SELECT s.*, g.quantity AS gift_quantity, g.status AS gift_status FROM visible_sales s
      JOIN gift_entitlements g ON g.sale_id = s.id AND g.agency_id = s.agency_id
    ), gifts AS (
      SELECT ${otherKey} AS bucket,
        sum(gift_quantity) FILTER (WHERE status = 'recorded' AND gift_status <> 'cancelled') AS "entitledUnits",
        sum(gift_quantity) FILTER (WHERE status = 'recorded' AND gift_status = 'distributed') AS "distributedUnits",
        sum(gift_quantity) FILTER (WHERE status = 'recorded' AND gift_status = 'undelivered') AS "undeliveredUnits",
        count(*) FILTER (WHERE status = 'voided' AND gift_status = 'distributed') AS "giftsToReview"
      FROM gift_rows
      GROUP BY bucket
    ), interaction_rows AS (
      SELECT i.*, a.supervisor_id FROM field_interactions i JOIN selected_campaigns c ON c.id = i.campaign_id
      JOIN assignments a ON a.id = i.assignment_id
      WHERE i.agency_id = ${agencyId}::uuid AND i.work_date BETWEEN ${from}::date AND ${to}::date
    ), scoped_interactions AS (
      SELECT i.*, p.wilaya_id, rw.region_id FROM interaction_rows i ${location(Prisma.sql`i`)}
      WHERE true ${operationScope(scope, Prisma.sql`i`)} ${facets(filters, Prisma.sql`i`)}
    ), interactions AS (
      SELECT ${otherKey} AS bucket, sum(count) AS interactions FROM scoped_interactions GROUP BY bucket
    ), visit_rows AS (
      SELECT v.id, v.agency_id, v.campaign_id, v.supervisor_id, v.point_of_sale_id,
        v.observed_animateur_ids, (visited_at AT TIME ZONE 'Africa/Algiers')::date AS work_date
      FROM supervisor_visits v JOIN selected_campaigns c ON c.id = v.campaign_id
      WHERE v.agency_id = ${agencyId}::uuid
        AND visited_at >= (${from}::date::timestamp AT TIME ZONE 'Africa/Algiers')
        AND visited_at < ((${to}::date::timestamp + interval '1 day') AT TIME ZONE 'Africa/Algiers')
    ), scoped_visits AS (
      SELECT v.*, p.wilaya_id, rw.region_id
      ${dimension === 'animateur' ? Prisma.sql`, observed_animateur_id` : Prisma.empty}
      FROM visit_rows v ${location(Prisma.sql`v`)} ${visitBranch}
      WHERE true ${visitsScope} ${facets(filters, Prisma.sql`v`, false)}
      ${
        filters.animateurIds
          ? Prisma.sql`AND EXISTS (
        SELECT 1 FROM unnest(v.observed_animateur_ids) AS selected(id)
        WHERE true ${whereIds(Prisma.sql`selected.id`, filters.animateurIds)}
      )`
          : Prisma.empty
      }
      ${dimension === 'animateur' ? whereIds(Prisma.sql`observed_animateur_id`, filters.animateurIds) : Prisma.empty}
      ${
        dimension === 'animateur' && scope.level !== 'agency'
          ? Prisma.sql`AND EXISTS (
        SELECT 1 FROM visible_days d WHERE d.work_date = v.work_date AND d.campaign_id = v.campaign_id
          AND d.point_of_sale_id = v.point_of_sale_id AND d.animateur_id = observed_animateur_id
      )`
          : Prisma.empty
      }
      ${scope.level === 'self' && dimension === 'animateur' ? Prisma.sql`AND observed_animateur_id = ${userId}::uuid` : Prisma.empty}
    ), visits AS (
      SELECT ${dimension === 'product' ? otherKey : visitsKey} AS bucket,
        count(DISTINCT id) AS "visitCount", count(DISTINCT point_of_sale_id) AS "visitedStores"
      FROM scoped_visits GROUP BY bucket
    ), planned AS (
      SELECT ${otherKey} AS bucket, count(DISTINCT point_of_sale_id) AS "assignedStores"
      FROM visible_days GROUP BY bucket
    ), completion AS (${completion}
    ), targets AS (
      SELECT ${key} AS bucket, sum(sales_target) AS "salesTarget", sum(sampling_target) AS "samplingTarget"
      FROM (${targetSource}) target_rows GROUP BY bucket
    ), visit_alert AS (
      SELECT count(*) AS "unvisitedStores"
      FROM (
        SELECT DISTINCT point_of_sale_id FROM visible_days
        WHERE work_date BETWEEN ${to}::date - 6 AND ${to}::date
        EXCEPT
        SELECT point_of_sale_id FROM scoped_visits WHERE work_date BETWEEN ${to}::date - 6 AND ${to}::date
      ) missing
    ), unvisited_period AS (
      SELECT count(*) AS "unvisitedInPeriod"
      FROM (
        SELECT DISTINCT point_of_sale_id FROM visible_days
        EXCEPT
        SELECT point_of_sale_id FROM scoped_visits
      ) missing
    ), buckets AS (
      SELECT bucket FROM attendance_stats UNION SELECT bucket FROM late_stats UNION SELECT bucket FROM sales_stats
      UNION SELECT bucket FROM gifts UNION SELECT bucket FROM interactions UNION SELECT bucket FROM visits
      UNION SELECT bucket FROM planned UNION SELECT bucket FROM targets
    )
    SELECT b.bucket, (coalesce(to_jsonb(a), '{}'::jsonb) || coalesce(to_jsonb(l), '{}'::jsonb) ||
      coalesce(to_jsonb(s), '{}'::jsonb) || coalesce(to_jsonb(g), '{}'::jsonb) ||
      coalesce(to_jsonb(i), '{}'::jsonb) || coalesce(to_jsonb(v), '{}'::jsonb) ||
      coalesce(to_jsonb(p), '{}'::jsonb) || coalesce(to_jsonb(t), '{}'::jsonb) ||
      coalesce(to_jsonb(c), '{}'::jsonb) ||
      CASE WHEN b.bucket = '' THEN
        (SELECT to_jsonb(visit_alert) FROM visit_alert) || (SELECT to_jsonb(unvisited_period) FROM unvisited_period)
      ELSE '{}'::jsonb END) - 'bucket' AS totals
    FROM buckets b
    LEFT JOIN attendance_stats a USING (bucket) LEFT JOIN late_stats l USING (bucket)
    LEFT JOIN sales_stats s USING (bucket) LEFT JOIN gifts g USING (bucket)
    LEFT JOIN interactions i USING (bucket) LEFT JOIN visits v USING (bucket)
    LEFT JOIN planned p USING (bucket) LEFT JOIN targets t USING (bucket)
    LEFT JOIN completion c USING (bucket)
    WHERE b.bucket IS NOT NULL ORDER BY b.bucket
  `;
}

export async function historicalAssignments(db, scope) {
  assertScope(scope);
  const { agencyId, userId, level } = scope;
  return db.$queryRaw`
    WITH RECURSIVE ${teamIntervals(scope)}
    SELECT DISTINCT a.campaign_id AS "campaignId", c.client_id AS "clientId",
      a.animateur_id AS "animateurId", a.supervisor_id AS "supervisorId",
      a.point_of_sale_id AS "pointOfSaleId", p.wilaya_id AS "wilayaId", rw.region_id AS "regionId"
    FROM assignments a JOIN campaigns c ON c.id = a.campaign_id AND c.agency_id = a.agency_id
    ${location(Prisma.sql`a`)}
    WHERE a.agency_id = ${agencyId}::uuid AND (
      a.status = 'approved'
      OR EXISTS (SELECT 1 FROM sales s WHERE s.assignment_id = a.id AND s.agency_id = a.agency_id)
      OR EXISTS (SELECT 1 FROM attendance_records r WHERE r.assignment_id = a.id AND r.agency_id = a.agency_id)
    ) AND (
      ${level} = 'agency'
      OR (${level} = 'self' AND a.animateur_id = ${userId ?? null}::uuid)
      OR (${level} = 'supervisor' AND a.supervisor_id = ${userId ?? null}::uuid)
      OR (${level} = 'regional' AND EXISTS (
        SELECT 1 FROM team WHERE team.user_id = a.supervisor_id AND starts <= a.end_date AND ends > a.start_date
      ))
    )
    UNION
    SELECT v.campaign_id, c.client_id, NULL::uuid, v.supervisor_id, v.point_of_sale_id,
      p.wilaya_id, rw.region_id
    FROM supervisor_visits v JOIN campaigns c ON c.id = v.campaign_id AND c.agency_id = v.agency_id
    ${location(Prisma.sql`v`)}
    WHERE v.agency_id = ${agencyId}::uuid AND (
      (${level} = 'supervisor' AND v.supervisor_id = ${userId ?? null}::uuid)
      OR (${level} = 'self' AND ${userId ?? null}::uuid = ANY(v.observed_animateur_ids))
      OR (${level} = 'regional' AND (
        ${visitInRegion(scope)}
        OR EXISTS (
          SELECT 1 FROM team WHERE team.user_id = v.supervisor_id
            AND starts <= (v.visited_at AT TIME ZONE 'Africa/Algiers')::date
            AND ends > (v.visited_at AT TIME ZONE 'Africa/Algiers')::date
        )
      ))
    )`;
}

/**
 * Issues visible to the scope in the period. `select`/`where`/`group` shape the result: the report
 * lists them by category and status, the store map counts the open ones per store.
 */
function issueQuery(db, scope, filters, { select, where = Prisma.empty, group, order }) {
  assertScope(scope);
  const { agencyId, userId, level } = scope;
  const { from, to } = filters;
  const role = level === 'regional' ? 'regional_manager' : 'supervisor';
  const nativeVisibility =
    level === 'agency'
      ? Prisma.empty
      : Prisma.sql`AND (
        (${level} = 'supervisor' AND i.reported_by = ${userId ?? null}::uuid)
        OR EXISTS (
          SELECT 1 FROM campaign_staff staff
          LEFT JOIN points_of_sale original ON original.id = i.original_store AND original.agency_id = i.agency_id
          WHERE staff.agency_id = i.agency_id AND staff.campaign_id = i.campaign_id
            AND staff.user_id = ${userId ?? null}::uuid AND staff.role::text = ${role}
            AND (staff.wilaya_id = original.wilaya_id OR (${level} = 'regional' AND i.original_store IS NULL))
        )
      )`;
  const issueOperation =
    level === 'agency'
      ? Prisma.empty
      : Prisma.sql`AND (
    i.reported_by = ${userId ?? null}::uuid OR i.supervisor_id IS NULL
    OR (${level} = 'supervisor' AND i.supervisor_id = ${userId ?? null}::uuid)
    OR ${regionalMember(Prisma.sql`i`)}
  )`;
  return db.$queryRaw`
    WITH RECURSIVE ${teamIntervals(scope)}, issue_rows AS (
      SELECT i.id, i.agency_id, i.campaign_id, i.category, i.status, i.reported_by,
        i.point_of_sale_id AS original_store,
        coalesce(i.point_of_sale_id, a.point_of_sale_id, v.point_of_sale_id) AS point_of_sale_id,
        coalesce(a.supervisor_id, v.supervisor_id) AS supervisor_id,
        a.animateur_id, (i.created_at AT TIME ZONE 'Africa/Algiers')::date AS work_date
      FROM issues i
      JOIN campaigns c ON c.id = i.campaign_id AND c.agency_id = i.agency_id
      LEFT JOIN assignments a ON a.id = i.assignment_id AND a.agency_id = i.agency_id
      LEFT JOIN supervisor_visits v ON v.id = i.visit_id AND v.agency_id = i.agency_id
      WHERE i.agency_id = ${agencyId}::uuid
        AND i.created_at >= (${from}::date::timestamp AT TIME ZONE 'Africa/Algiers')
        AND i.created_at < ((${to}::date::timestamp + interval '1 day') AT TIME ZONE 'Africa/Algiers')
        ${whereIds(Prisma.sql`i.campaign_id`, filters.campaignIds)}
        ${whereIds(Prisma.sql`c.client_id`, filters.clientId ? [filters.clientId] : undefined)}
    )
    SELECT ${select}
    FROM issue_rows i
    LEFT JOIN points_of_sale p ON p.id = i.point_of_sale_id AND p.agency_id = i.agency_id
    LEFT JOIN region_wilayas rw ON rw.wilaya_id = p.wilaya_id AND rw.agency_id = i.agency_id
    WHERE true ${nativeVisibility} ${issueOperation} ${facets(filters, Prisma.sql`i`)} ${where}
    GROUP BY ${group} ORDER BY ${order}
  `;
}

export function issues(db, scope, filters) {
  return issueQuery(db, scope, filters, {
    select: Prisma.sql`i.category, i.status::text, count(*)::int AS count`,
    group: Prisma.sql`i.category, i.status`,
    order: Prisma.sql`i.category, i.status`,
  });
}

/** Open issues (created in the period, not resolved or closed) per store. */
export function openIssuesByStore(db, scope, filters) {
  return issueQuery(db, scope, filters, {
    select: Prisma.sql`i.point_of_sale_id::text AS id, count(*)::int AS count`,
    where: Prisma.sql`AND i.status IN ('open', 'in_progress') AND i.point_of_sale_id IS NOT NULL`,
    group: Prisma.sql`i.point_of_sale_id`,
    order: Prisma.sql`i.point_of_sale_id`,
  });
}

const selectedCampaigns = (agencyId, filters) => Prisma.sql`selected_campaigns AS (
  SELECT c.id, c.agency_id, c.start_date, c.end_date, c.status
  FROM campaigns c WHERE c.agency_id = ${agencyId}::uuid
  ${whereIds(Prisma.sql`c.id`, filters.campaignIds)}
  ${whereIds(Prisma.sql`c.client_id`, filters.clientId ? [filters.clientId] : undefined)}
)`;

/**
 * Last supervisor visit per store, within what the scope may see. Animateurs see visits they were
 * observed in; supervisors their own; regional managers their team's (and separately staffed points).
 */
export async function lastVisits(db, scope, filters, storeIds) {
  assertScope(scope);
  if (!storeIds.length) return [];
  const { agencyId, userId } = scope;
  const visitDate = Prisma.sql`(v.visited_at AT TIME ZONE 'Africa/Algiers')::date`;
  const visible =
    scope.level === 'agency'
      ? Prisma.empty
      : scope.level === 'self'
        ? Prisma.sql`AND ${userId}::uuid = ANY(v.observed_animateur_ids)`
        : scope.level === 'supervisor'
          ? Prisma.sql`AND v.supervisor_id = ${userId}::uuid`
          : scope.level === 'regional'
            ? Prisma.sql`AND (
              EXISTS (SELECT 1 FROM team WHERE team.user_id = v.supervisor_id
                AND team.starts <= ${visitDate} AND team.ends > ${visitDate})
              OR ${visitInRegion(scope)}
            )`
            : Prisma.sql`AND false`;
  return db.$queryRaw`
    WITH RECURSIVE ${teamIntervals(scope)}, ${selectedCampaigns(agencyId, filters)}
    SELECT v.point_of_sale_id::text AS id, max(v.visited_at) AS "lastVisit"
    FROM supervisor_visits v JOIN selected_campaigns c ON c.id = v.campaign_id
    JOIN points_of_sale p ON p.id = v.point_of_sale_id AND p.agency_id = v.agency_id
    WHERE v.agency_id = ${agencyId}::uuid ${whereIds(Prisma.sql`v.point_of_sale_id`, storeIds)} ${visible}
    GROUP BY v.point_of_sale_id`;
}

/**
 * Today's attendance per store (live map): one count per approved assignment working today, by what
 * its Animateur has done so far. No names, no coordinates: only counts per store.
 */
export async function todayAttendanceByStore(db, scope, filters, storeIds, instant) {
  assertScope(scope);
  if (!storeIds.length) return [];
  const { agencyId } = scope;
  return db.$queryRaw`
    WITH RECURSIVE ${teamIntervals(scope)}, ${selectedCampaigns(agencyId, filters)},
    today AS (SELECT (${instant}::timestamptz AT TIME ZONE 'Africa/Algiers')::date AS d),
    todays AS (
      SELECT a.id, a.campaign_id, a.point_of_sale_id, a.animateur_id, a.supervisor_id, a.work_date
      FROM (SELECT x.*, t.d AS work_date FROM assignments x CROSS JOIN today t) a
      JOIN selected_campaigns c ON c.id = a.campaign_id
      WHERE a.agency_id = ${agencyId}::uuid AND a.status = 'approved' AND c.status = 'active'
        AND a.start_date <= a.work_date AND a.end_date >= a.work_date
        AND c.start_date <= a.work_date AND c.end_date >= a.work_date
        AND (coalesce(cardinality(a.work_days), 0) = 0 OR extract(isodow FROM a.work_date)::int = ANY(a.work_days))
        ${whereIds(Prisma.sql`a.point_of_sale_id`, storeIds)}
        ${operationScope(scope, Prisma.sql`a`)}
    )
    SELECT a.point_of_sale_id::text AS id,
      count(*)::int AS animateurs,
      count(*) FILTER (WHERE ab.id IS NOT NULL)::int AS absent,
      count(*) FILTER (WHERE ab.id IS NULL AND r.id IS NULL)::int AS "notSent",
      count(*) FILTER (WHERE ab.id IS NULL AND r.id IS NOT NULL AND r.is_late)::int AS late,
      count(*) FILTER (WHERE ab.id IS NULL AND r.id IS NOT NULL AND NOT r.is_late)::int AS present,
      array_agg(DISTINCT a.campaign_id::text) AS "campaignIds"
    FROM todays a
    LEFT JOIN LATERAL (
      SELECT x.id FROM absences x WHERE x.assignment_id = a.id AND x.work_date = a.work_date
        AND x.voided_at IS NULL AND x.agency_id = ${agencyId}::uuid LIMIT 1
    ) ab ON true
    LEFT JOIN LATERAL (
      SELECT x.id, x.is_late FROM attendance_records x
      WHERE x.assignment_id = a.id AND x.work_date = a.work_date AND x.status <> 'rejected'
        AND x.agency_id = ${agencyId}::uuid ORDER BY x.recorded_at LIMIT 1
    ) r ON true
    GROUP BY a.point_of_sale_id`;
}

/**
 * Counts per ISO weekday x Algiers hour (the day cuts at local midnight, no DST in Algeria):
 * recorded sales, or late attendance check-ins, in the period.
 */
export async function timeHeatmap(db, scope, filters, kind) {
  assertScope(scope);
  const { agencyId } = scope;
  const { from, to } = filters;
  const source =
    kind === 'sales'
      ? Prisma.sql`
        SELECT s.sold_at AS at, s.agency_id, s.animateur_id, s.supervisor_id, s.point_of_sale_id, s.work_date
        FROM sales s JOIN selected_campaigns c ON c.id = s.campaign_id
        WHERE s.agency_id = ${agencyId}::uuid AND s.status = 'recorded'
          AND s.work_date BETWEEN ${from}::date AND ${to}::date`
      : Prisma.sql`
        SELECT x.recorded_at AS at, x.agency_id, x.animateur_id, r.supervisor_id, x.point_of_sale_id, x.work_date
        FROM attendance_records x JOIN selected_campaigns c ON c.id = x.campaign_id
        JOIN assignments r ON r.id = x.assignment_id AND r.agency_id = x.agency_id
        WHERE x.agency_id = ${agencyId}::uuid AND x.is_late
          AND x.work_date BETWEEN ${from}::date AND ${to}::date`;
  return db.$queryRaw`
    WITH RECURSIVE ${teamIntervals(scope)}, ${selectedCampaigns(agencyId, filters)}, events AS (${source})
    SELECT extract(isodow FROM e.at AT TIME ZONE 'Africa/Algiers')::int AS weekday,
      extract(hour FROM e.at AT TIME ZONE 'Africa/Algiers')::int AS hour, count(*)::int AS count
    FROM events e ${location(Prisma.sql`e`)}
    WHERE true ${operationScope(scope, Prisma.sql`e`)} ${facets(filters, Prisma.sql`e`)}
    GROUP BY 1, 2 ORDER BY 1, 2`;
}
