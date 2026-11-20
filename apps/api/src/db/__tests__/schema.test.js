// Verifies the migrated database against docs/04-database-design.md by querying the catalogs:
// tables, enums, foreign keys (with ON DELETE), uniques, indexes, constraints, triggers, key types.
import { DB_ENUMS } from '@fieldflow/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../client.js';

// ─── Expected, from the design document ──────────────────────────────────────

/** Table → foreign keys "column(s)>referenced_table", "!" suffix = ON DELETE CASCADE. */
const FOREIGN_KEYS = {
  agencies: [],
  users: ['agency_id>agencies', 'client_id>clients', 'wilaya_id>wilayas', 'commune_id>communes'],
  animateur_profiles: ['user_id>users', 'agency_id>agencies'],
  refresh_tokens: ['agency_id>agencies', 'user_id>users!', 'replaced_by_id>refresh_tokens'],
  wilayas: [],
  communes: ['wilaya_id>wilayas'],
  regions: ['agency_id>agencies'],
  region_wilayas: ['region_id>regions!', 'wilaya_id>wilayas!', 'agency_id>agencies'],
  reporting_lines: ['agency_id>agencies', 'user_id>users', 'manager_id>users'],
  points_of_sale: ['agency_id>agencies', 'wilaya_id>wilayas', 'commune_id>communes'],
  clients: ['agency_id>agencies'],
  products: ['agency_id>agencies', 'client_id>clients'],
  stock_items: ['agency_id>agencies', 'client_id>clients'],
  campaigns: ['agency_id>agencies', 'client_id>clients'],
  campaign_status_history: ['agency_id>agencies', 'campaign_id>campaigns', 'changed_by>users'],
  campaign_wilayas: ['campaign_id>campaigns', 'wilaya_id>wilayas', 'agency_id>agencies'],
  campaign_staff: ['agency_id>agencies', 'campaign_id,wilaya_id>campaign_wilayas', 'user_id>users'],
  campaign_points_of_sale: [
    'campaign_id>campaigns!',
    'point_of_sale_id>points_of_sale!',
    'agency_id>agencies',
  ],
  campaign_products: ['campaign_id>campaigns!', 'product_id>products!', 'agency_id>agencies'],
  campaign_documents: ['campaign_id>campaigns!', 'file_id>files!', 'agency_id>agencies'],
  rule_sets: ['agency_id>agencies', 'campaign_id>campaigns', 'approved_by>users'],
  campaign_rules: ['agency_id>agencies', 'rule_set_id>rule_sets'],
  promotions: ['agency_id>agencies', 'rule_set_id>rule_sets'],
  promotion_tiers: [
    'agency_id>agencies',
    'promotion_id>promotions',
    'product_id>products',
    'stock_item_id>stock_items',
  ],
  assignments: [
    'agency_id>agencies',
    'campaign_id>campaigns',
    'animateur_id>users',
    'point_of_sale_id>points_of_sale',
    'campaign_id,point_of_sale_id>campaign_points_of_sale',
    'supervisor_id>users',
    'proposed_by>users',
    'decided_by>users',
    'replaces_assignment_id>assignments',
  ],
  attendance_records: [
    'agency_id>agencies',
    'assignment_id>assignments',
    'campaign_id>campaigns',
    'animateur_id>users',
    'point_of_sale_id>points_of_sale',
    'rule_set_id>rule_sets',
    'photo_file_id>files',
    'reviewed_by>users',
  ],
  absences: [
    'agency_id>agencies',
    'assignment_id>assignments',
    'animateur_id>users',
    'recorded_by>users',
    'replacement_assignment_id>assignments',
    'voided_by>users',
  ],
  supervisor_visits: [
    'agency_id>agencies',
    'campaign_id>campaigns',
    'supervisor_id>users',
    'point_of_sale_id>points_of_sale',
  ],
  visit_photos: ['visit_id>supervisor_visits!', 'file_id>files!', 'agency_id>agencies'],
  customers: ['agency_id>agencies', 'campaign_id>campaigns', 'created_by>users'],
  sales: [
    'agency_id>agencies',
    'campaign_id>campaigns',
    'assignment_id>assignments',
    'point_of_sale_id>points_of_sale',
    'animateur_id>users',
    'supervisor_id>users',
    'customer_id>customers',
    'rule_set_id>rule_sets',
    'proof_file_id>files',
    'voided_by>users',
  ],
  sale_items: ['agency_id>agencies', 'sale_id>sales', 'product_id>products'],
  gift_entitlements: [
    'agency_id>agencies',
    'campaign_id>campaigns',
    'sale_id>sales',
    'promotion_id>promotions',
    'promotion_tier_id>promotion_tiers',
    'stock_item_id>stock_items',
    'shortage_issue_id>issues',
  ],
  field_interactions: [
    'agency_id>agencies',
    'campaign_id>campaigns',
    'assignment_id>assignments',
    'animateur_id>users',
    'point_of_sale_id>points_of_sale',
    'created_by>users',
  ],
  stock_locations: ['agency_id>agencies', 'campaign_id>campaigns', 'user_id>users'],
  stock_movements: [
    'agency_id>agencies',
    'campaign_id>campaigns',
    'from_location_id>stock_locations',
    'to_location_id>stock_locations',
    'gift_entitlement_id>gift_entitlements',
    'issue_id>issues',
    'resolves_movement_id>stock_movements',
    'proof_file_id>files',
    'created_by>users',
    'confirmed_by>users',
    'approved_by>users',
  ],
  stock_movement_lines: [
    'agency_id>agencies',
    'movement_id>stock_movements',
    'stock_item_id>stock_items',
  ],
  stock_ledger_entries: [
    'agency_id>agencies',
    'campaign_id>campaigns',
    'movement_id>stock_movements',
    'movement_line_id>stock_movement_lines',
    'location_id>stock_locations',
    'stock_item_id>stock_items',
  ],
  stock_balances: [
    'location_id>stock_locations',
    'stock_item_id>stock_items',
    'agency_id>agencies',
  ],
  tombolas: ['agency_id>agencies', 'campaign_id>campaigns'],
  tombola_entries: [
    'agency_id>agencies',
    'tombola_id>tombolas',
    'customer_id>customers',
    'sale_id>sales',
  ],
  tombola_draws: ['agency_id>agencies', 'tombola_id>tombolas', 'drawn_by>users'],
  tombola_winners: ['agency_id>agencies', 'draw_id>tombola_draws', 'entry_id>tombola_entries'],
  issues: [
    'agency_id>agencies',
    'campaign_id>campaigns',
    'point_of_sale_id>points_of_sale',
    'stock_item_id>stock_items',
    'assignment_id>assignments',
    'visit_id>supervisor_visits',
    'reported_by>users',
    'assigned_to>users',
    'resolved_by>users',
  ],
  issue_comments: ['agency_id>agencies', 'issue_id>issues', 'author_id>users'],
  issue_attachments: [
    'issue_id>issues!',
    'file_id>files!',
    'agency_id>agencies',
    'issue_id,comment_id>issue_comments',
  ],
  announcements: [
    'agency_id>agencies',
    'campaign_id>campaigns',
    'author_id>users',
    'wilaya_id>wilayas',
  ],
  announcement_reads: ['announcement_id>announcements!', 'user_id>users!', 'agency_id>agencies'],
  notifications: ['agency_id>agencies', 'user_id>users'],
  files: ['agency_id>agencies', 'uploaded_by>users'],
  audit_logs: ['agency_id>agencies'],
  idempotency_keys: ['user_id>users', 'agency_id>agencies'],
  ai_requests: ['agency_id>agencies', 'requested_by>users'],
  ai_suggestions: ['agency_id>agencies', 'reviewed_by>users', 'request_id>ai_requests'],
};

const TABLES = Object.keys(FOREIGN_KEYS);
const REFERENCE_TABLES = ['agencies', 'wilayas', 'communes'];
/** Append-only / insert-only tables: no updated_at (ai_requests tracks sent_at / completed_at instead). */
const IMMUTABLE_TABLES = [
  'ai_requests',
  'field_interactions',
  'region_wilayas',
  'campaign_status_history',
  'campaign_points_of_sale',
  'campaign_products',
  'campaign_documents',
  'visit_photos',
  'sale_items',
  'stock_locations',
  'stock_ledger_entries',
  'tombola_draws',
  'issue_comments',
  'issue_attachments',
  'announcement_reads',
  'audit_logs',
];
const SOFT_DELETE_TABLES = [
  'clients',
  'products',
  'stock_items',
  'points_of_sale',
  'regions',
  'files',
];
/** Optimistic-locking `version` (campaigns, points_of_sale, issues) + rule_sets' own version number. */
const VERSIONED_TABLES = ['campaigns', 'points_of_sale', 'issues', 'rule_sets'];

const PRIMARY_KEYS = [
  'animateur_profiles(user_id)',
  'region_wilayas(region_id,wilaya_id)',
  'campaign_wilayas(campaign_id,wilaya_id)',
  'campaign_points_of_sale(campaign_id,point_of_sale_id)',
  'campaign_products(campaign_id,product_id)',
  'campaign_documents(campaign_id,file_id)',
  'visit_photos(visit_id,file_id)',
  'stock_balances(location_id,stock_item_id)',
  'issue_attachments(issue_id,file_id)',
  'announcement_reads(announcement_id,user_id)',
  'idempotency_keys(user_id,key)',
];

const UNIQUES = [
  'issue_comments(issue_id,id)',
  'agencies(code)',
  'users(email)',
  'refresh_tokens(token_hash)',
  'communes(code)',
  'regions(agency_id,code)',
  'region_wilayas(agency_id,wilaya_id)',
  'points_of_sale(agency_id,code)',
  'products(client_id,sku)',
  'stock_items(client_id,sku)',
  'campaigns(agency_id,code)',
  'campaign_staff(campaign_id,wilaya_id,user_id)',
  'rule_sets(campaign_id,version)',
  'campaign_rules(rule_set_id,rule_type)',
  'promotion_tiers(promotion_id,product_id,min_quantity)',
  'attendance_records(assignment_id,work_date,checkpoint)',
  'absences(assignment_id,work_date)',
  'sale_items(sale_id,product_id)',
  'gift_entitlements(sale_id,promotion_id)',
  'stock_locations(campaign_id,kind,user_id)',
  'stock_movement_lines(movement_id,stock_item_id)',
  'tombolas(campaign_id,name)',
  'tombola_entries(tombola_id,entry_number)',
  'tombola_draws(tombola_id)',
  'tombola_winners(draw_id,rank)',
  'tombola_winners(draw_id,entry_id)',
  'files(storage_key)',
  'ai_suggestions(request_id)',
];

const INDEXES = [
  'field_interactions(campaign_id,work_date)',
  'field_interactions(animateur_id,work_date)',
  'issues(assignment_id)',
  'gift_entitlements(shortage_issue_id)',
  'users(agency_id,role,status)',
  'users(agency_id,wilaya_id)',
  'refresh_tokens(family_id)',
  'communes(wilaya_id)',
  'points_of_sale(agency_id,wilaya_id)',
  'campaigns(agency_id,status)',
  'campaigns(client_id)',
  'campaigns(agency_id,start_date,end_date)',
  'assignments(campaign_id,status)',
  'assignments(supervisor_id,start_date,end_date)',
  'assignments(animateur_id,start_date)',
  'assignments(point_of_sale_id)',
  'attendance_records(campaign_id,work_date)',
  'supervisor_visits(supervisor_id,visited_at)',
  'sales(campaign_id,work_date)',
  'sales(animateur_id,work_date)',
  'sales(supervisor_id,work_date)',
  'sales(point_of_sale_id,work_date)',
  'sales(customer_id)',
  'stock_ledger_entries(location_id,stock_item_id,id)',
  'stock_ledger_entries(movement_id)',
  'tombola_entries(tombola_id,customer_id)',
  'issues(campaign_id,status)',
  'issues(assigned_to,status)',
  'issue_comments(issue_id,created_at)',
  'issue_attachments(issue_id,comment_id)',
  'files(agency_id,sha256)',
  'audit_logs(entity_type,entity_id,id)',
  'audit_logs(actor_id,created_at)',
  'ai_suggestions(subject_type,subject_id)',
];

/** Hand-written partial / expression / NULLS NOT DISTINCT indexes: name → [unique, predicate or flag]. */
const NAMED_INDEXES = {
  issues_one_open_shortage_per_assignment_item: {
    unique: true,
    where: /stock_shortage.*assignment_id IS NOT NULL/,
  },
  reporting_lines_one_open: { unique: true, where: /valid_to IS NULL/ },
  rule_sets_one_draft: { unique: true, where: /status = 'draft'/ },
  customers_campaign_phone: { unique: true, where: /phone IS NOT NULL/ },
  clients_agency_name_active: {
    unique: true,
    where: /deleted_at IS NULL/,
    definition: /lower\(name\)/,
  },
  attendance_pending: { unique: false, where: /status = 'pending'/ },
  entitlements_undelivered: { unique: false, where: /status = 'undelivered'/ },
  notifications_unread: { unique: false, where: /read_at IS NULL/, definition: /created_at DESC/ },
  promotion_tiers_unique: { unique: true, nullsNotDistinct: true },
  stock_locations_unique: { unique: true, nullsNotDistinct: true },
  stock_movements_one_per_entitlement: { unique: true, where: /gift_entitlement_id IS NOT NULL/ },
  absences_one_active_per_day: { unique: true, where: /voided_at IS NULL/ },
};

const CHECKS = [
  'field_interactions_kind_check',
  'field_interactions_count_check',
  'absences_void_consistent',
  'agencies_code_format',
  'users_client_role',
  'wilayas_id_range',
  'reporting_lines_not_self',
  'reporting_lines_valid_range',
  'points_of_sale_coordinates',
  'campaigns_date_range',
  'campaigns_approver_role',
  'campaign_wilayas_required_non_negative',
  'promotion_tiers_min_quantity_positive',
  'promotion_tiers_gift_quantity_positive',
  'assignments_date_range',
  'assignments_shift_pair',
  'assignments_work_days_iso',
  'attendance_records_coordinates',
  'supervisor_visits_coordinates',
  'sales_voided_consistency',
  'sale_items_quantity_positive',
  'gift_entitlements_quantity_positive',
  'stock_locations_holder_user',
  'stock_movements_distinct_locations',
  'stock_movements_distribution_entitlement',
  'stock_movement_lines_quantity_positive',
  'stock_movement_lines_received_range',
  'stock_ledger_entries_delta_non_zero',
  'stock_balances_non_negative',
  'tombolas_counts',
];

const EXCLUSIONS = ['reporting_lines_no_overlap', 'assignments_no_overlap'];

const TRIGGERS = [
  'ai_suggestions.ai_suggestions_review_only',
  'ai_suggestions.ai_suggestions_no_delete',
  'gift_entitlements.gift_entitlements_shortage_issue_immutable',
  'field_interactions.field_interactions_append_only',
  'stock_ledger_entries.stock_ledger_append_only',
  'audit_logs.audit_logs_append_only',
  'stock_ledger_entries.ledger_balanced',
  'tombola_entries.tombola_locked',
  'tombola_winners.tombola_locked',
  'attendance_records.campaign_closed_guard',
  'sales.campaign_closed_guard',
  'stock_movements.campaign_closed_guard',
  'supervisor_visits.campaign_closed_guard',
  'tombola_entries.campaign_closed_guard',
  'issues.campaign_closed_guard',
];

/** table.column → formatted type (pg format_type). */
const COLUMN_TYPES = {
  'users.email': 'citext',
  'wilayas.id': 'smallint',
  'communes.id': 'integer',
  'communes.code': 'text',
  'products.reference_price': 'numeric(14,2)',
  'campaigns.budget_amount': 'numeric(14,2)',
  'points_of_sale.latitude': 'numeric(9,6)',
  'attendance_records.longitude': 'numeric(9,6)',
  'assignments.work_days': 'smallint[]',
  'assignments.shift_start': 'time(6) without time zone',
  'announcements.target_roles': 'user_role[]',
  'stock_ledger_entries.id': 'bigint',
  'audit_logs.id': 'bigint',
  'audit_logs.ip': 'inet',
  'agencies.settings': 'jsonb',
  'files.size_bytes': 'bigint',
  'ai_suggestions.confidence': 'numeric(4,3)',
  'campaigns.start_date': 'date',
  'sales.sold_at': 'timestamp(6) with time zone',
};

// ─── Actual, from the catalogs ───────────────────────────────────────────────

let actual;
beforeAll(async () => {
  // Catalog identifier types (name, "char", sql_identifier) are cast to text: Prisma cannot read them.
  const [tables, columns, enums, foreignKeys, indexes, constraints, triggers] = await Promise.all([
    prisma.$queryRaw`
      SELECT table_name::text AS name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`,
    prisma.$queryRaw`
      SELECT c.relname::text AS "table", a.attname::text AS "column",
             format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS "notNull", pg_get_expr(d.adbin, d.adrelid) AS "defaultValue"
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped`,
    prisma.$queryRaw`
      SELECT t.typname::text AS name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS "values"
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typnamespace = 'public'::regnamespace GROUP BY t.typname`,
    prisma.$queryRaw`
      SELECT c.conrelid::regclass::text AS "table", c.confrelid::regclass::text AS ref,
             c.confdeltype::text AS "onDelete",
             (SELECT string_agg(a.attname::text, ',' ORDER BY k.ord)
                FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols
      FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`,
    prisma.$queryRaw`
      SELECT t.relname::text AS "table", i.relname::text AS name, ix.indisunique AS "unique",
             ix.indisprimary AS "primary", ix.indnullsnotdistinct AS "nullsNotDistinct",
             pg_get_expr(ix.indpred, ix.indrelid) AS "where", pg_get_indexdef(ix.indexrelid) AS definition,
             (SELECT string_agg(a.attname::text, ',' ORDER BY k.ord)
                FROM unnest(ix.indkey) WITH ORDINALITY k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum) AS cols
      FROM pg_index ix
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_class t ON t.oid = ix.indrelid
      WHERE t.relnamespace = 'public'::regnamespace`,
    prisma.$queryRaw`
      SELECT conname::text AS name, contype::text AS type, pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace AND contype IN ('c', 'x')`,
    prisma.$queryRaw`
      SELECT c.relname::text AS "table", t.tgname::text AS name
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal`,
  ]);

  const columnsOf = (table) => columns.filter((c) => c.table === table).map((c) => c.column);
  actual = {
    tables: tables.map((t) => t.name).sort(),
    columns,
    columnsOf,
    constraints,
    enums: Object.fromEntries(enums.map((e) => [e.name, e.values])),
    foreignKeys,
    indexes,
    signature: (i) => `${i.table}(${i.cols ?? ''})`,
    checks: constraints.filter((c) => c.type === 'c').map((c) => c.name),
    exclusions: constraints.filter((c) => c.type === 'x').map((c) => c.name),
    triggers: triggers.map((t) => `${t.table}.${t.name}`),
  };
});

describe('database schema matches docs/04-database-design.md', () => {
  it('has the original tables and field interactions', () => {
    expect(TABLES).toHaveLength(54);
    expect(actual.tables).toEqual([...TABLES].sort());
  });

  it('has every enum with the values of packages/shared (same order)', () => {
    expect(actual.enums).toEqual(
      Object.fromEntries(Object.entries(DB_ENUMS).map(([k, v]) => [k, [...v]])),
    );
  });

  it('applies the shared column conventions', () => {
    for (const table of TABLES) {
      const cols = actual.columnsOf(table);
      expect(cols, `${table}.creation timestamp`).toContain(
        table === 'field_interactions' ? 'recorded_at' : 'created_at',
      );
      expect(cols.includes('agency_id'), `${table}.agency_id`).toBe(
        !REFERENCE_TABLES.includes(table),
      );
      expect(cols.includes('updated_at'), `${table}.updated_at`).toBe(
        !IMMUTABLE_TABLES.includes(table),
      );
      expect(cols.includes('deleted_at'), `${table}.deleted_at`).toBe(
        SOFT_DELETE_TABLES.includes(table),
      );
      expect(cols.includes('version'), `${table}.version`).toBe(VERSIONED_TABLES.includes(table));
    }
  });

  it('reflects the organization demo flags and same-day reporting constraint', () => {
    for (const table of ['regions', 'points_of_sale']) {
      expect(
        actual.columns.find((column) => column.table === table && column.column === 'is_demo'),
      ).toMatchObject({ type: 'boolean', notNull: true, defaultValue: 'false' });
    }
    const range = actual.constraints.find(({ name }) => name === 'reporting_lines_valid_range');
    expect(range?.definition).toMatch(/valid_to >= valid_from/);
  });

  it('allows existing issue attachments without a comment and stores comment IDs as UUIDs', () => {
    const column = actual.columns.find(
      ({ table, column }) => table === 'issue_attachments' && column === 'comment_id',
    );
    expect(column).toMatchObject({ type: 'uuid', notNull: false });
  });

  it('uses the designed column types', () => {
    for (const [key, type] of Object.entries(COLUMN_TYPES)) {
      const [table, column] = key.split('.');
      const found = actual.columns.find((c) => c.table === table && c.column === column);
      expect(found?.type, key).toBe(type);
    }
  });

  it('has exactly the designed foreign keys, RESTRICT by default and CASCADE only where designed', () => {
    const expected = Object.entries(FOREIGN_KEYS)
      .flatMap(([table, fks]) => fks.map((fk) => `${table}.${fk}`))
      .sort();
    const found = actual.foreignKeys
      .map((fk) => {
        if (!['r', 'c'].includes(fk.onDelete))
          return `${fk.table}.${fk.cols}>${fk.ref} (ON DELETE ${fk.onDelete})`;
        return `${fk.table}.${fk.cols}>${fk.ref}${fk.onDelete === 'c' ? '!' : ''}`;
      })
      .sort();
    expect(found).toEqual(expected);
  });

  it('has the designed composite primary keys', () => {
    const primaries = actual.indexes.filter((i) => i.primary).map(actual.signature);
    expect(primaries).toEqual(expect.arrayContaining(PRIMARY_KEYS));
  });

  it('has every designed unique constraint', () => {
    const uniques = actual.indexes.filter((i) => i.unique && !i.primary).map(actual.signature);
    expect(uniques).toEqual(expect.arrayContaining(UNIQUES));
  });

  it('has every designed index', () => {
    const all = actual.indexes.filter((i) => !i.where).map(actual.signature);
    expect(all).toEqual(expect.arrayContaining(INDEXES));
  });

  it.each(Object.entries(NAMED_INDEXES))('has the hand-written index %s', (name, spec) => {
    const index = actual.indexes.find((i) => i.name === name);
    expect(index, name).toBeDefined();
    expect(index.unique).toBe(spec.unique);
    if (spec.where) expect(index.where).toMatch(spec.where);
    if (spec.definition) expect(index.definition).toMatch(spec.definition);
    if (spec.nullsNotDistinct) expect(index.nullsNotDistinct).toBe(true);
  });

  it('has every hand-written CHECK and exclusion constraint', () => {
    expect(actual.checks).toEqual(expect.arrayContaining(CHECKS));
    expect([...actual.exclusions].sort()).toEqual([...EXCLUSIONS].sort());
  });

  it('has exactly the hand-written triggers', () => {
    expect([...actual.triggers].sort()).toEqual([...TRIGGERS].sort());
  });
});
