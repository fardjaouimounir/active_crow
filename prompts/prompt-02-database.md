# Prompt 02 — Database Schema, Constraints & Reference Data

> Paste everything below this line into Claude Code after Prompt 01 is accepted.

---

## 1. Context

Read `CLAUDE.md`, then read `docs/04-database-design.md` completely. That document (in Arabic, with
all table/column names in English) is the **approved** database design: 52 tables, enums, keys,
indexes, constraints, three Mermaid ERDs and a SQL block of hand-written constraints. Your job is to
implement it faithfully, not to redesign it.

Prompt 01 delivered the monorepo, the API skeleton, the web skeleton and a Dockerised PostgreSQL 17
(`fieldflow_dev`, `fieldflow_test`). This is wave 1, part 2: the database foundation every module
will build on. Mistakes here propagate everywhere, so correctness and tests matter more than speed.

## 2. Objective

1. Prisma 7 working in a **JavaScript-only** project, with a generated client usable from ESM code.
2. `schema.prisma` implementing every table in `docs/04-database-design.md`.
3. Migrations that also create every constraint, trigger and partial index Prisma cannot express.
4. A database module (client + transaction helper) and a health check that includes the database.
5. Reference data seeded: one agency, 69 wilayas, 1,541 communes.
6. Tests proving that the database itself rejects every forbidden state listed below.

## 3. Scope

### Step 0 — Prisma 7 + JavaScript spike (do this first, report before continuing)

Prisma 7's default `prisma-client` generator emits TypeScript source, and Prisma 7 requires a driver
adapter and a `prisma.config` file. Our hard rule is "no TypeScript files in our source".

1. Install the current Prisma 7.x (`prisma`, `@prisma/client`, `@prisma/adapter-pg`, `pg`). Do not use Prisma 8.
2. Read the installed version's documentation for generators and find an approach that satisfies all of:
   - our application code is `.js` ESM and imports the client normally;
   - no `.ts` file is committed or hand-maintained by us;
   - `npm run db:generate` is a single command that leaves a client runnable on Node 24 without a
     TypeScript toolchain at runtime.
   Acceptable options, in order of preference: a generator option that outputs JavaScript; the legacy
   `prisma-client-js` generator if it is still supported in the installed 7.x; generating the
   TypeScript client into a git-ignored folder and compiling it to JS with esbuild as part of
   `db:generate` (build artefact only).
3. Use a `prisma.config` file in JavaScript (`.mjs` or `.js`) that loads `.env` via `dotenv/config`.
4. Prove it with a 3-line script that connects through the adapter and runs `SELECT 1`.
5. Write the chosen approach and the reason in `apps/api/prisma/README.md` and in the final report.

If no approach meets all three conditions, **stop and report** with the options and trade-offs. Do not
switch ORM on your own.

### Step 1 — Schema

Implement `apps/api/prisma/schema.prisma` from `docs/04-database-design.md`:
- All enums in section "Enums".
- All tables in sections "الهوية والهيكل والجغرافيا" through "Issues والإعلانات…" (10 + 14 + 5 + 4 + 5 + 4 + 10 = 52).
- Shared conventions from section "الاتفاقيات المشتركة": `id` uuid default `gen_random_uuid()`,
  `agency_id` on every business table, `created_at`, `updated_at` only on mutable tables,
  `deleted_at` only on the listed reference tables, `version` where listed.
- Prisma model names in PascalCase singular, fields camelCase, mapped to snake_case tables/columns
  with `@@map` / `@map`.
- Every FK listed in the design, with `onDelete: Restrict` by default (`Cascade` only for
  `refresh_tokens` and pure join tables). Name every relation explicitly where two FKs point to the
  same table (e.g. `users` ↔ `reporting_lines`, `stock_locations` ↔ `stock_movements`).
- Every unique constraint and index listed in the design.
- `citext` for `users.email`; `numeric(14,2)` for money; `numeric(9,6)` for coordinates; `smallint[]`
  for `assignments.work_days`; `user_role[]` for `announcements.target_roles`; `jsonb` where listed.

Approved adjustments to apply on top of the document:
- `gift_entitlements` has a `campaign_id` column (FK, NOT NULL) — the document's partial index needs it.
- `wilayas.id` is `smallint` 1–69 (2026 reform). `communes` has `id int` (generated), `code text UNIQUE`
  (official commune code), `wilaya_id` per the 2026 map, `name_ar`, `name_en`.
- `customers` belong to one campaign (as designed). Gift distribution requires a holder location with
  sufficient confirmed balance (enforced by the non-negative balance constraint).

### Step 2 — Migrations

1. `init` migration generated from the schema.
2. A second migration created with `prisma migrate dev --create-only`, hand-edited to add everything in
   section "القيود والفهارس الحرجة بـ SQL يدوي" of the design document, exactly as written, plus:
   - Trigger `tombola_locked`: once the parent tombola has `status = 'drawn'`, reject INSERT/UPDATE/DELETE
     on `tombola_entries`, reject INSERT/DELETE on `tombola_winners`, and reject UPDATE on
     `tombola_winners` except of `delivery_status` and `delivered_at` (prize delivery is tracked after
     the draw). The draw service will insert the draw and winners first and set `status = 'drawn'` last,
     in one transaction, so the trigger never blocks the draw itself. Document this ordering in
     `CONSTRAINTS.md`.
   - Trigger `campaign_closed_guard`: rejects INSERT on `attendance_records`, `sales`,
     `stock_movements`, `supervisor_visits`, `tombola_entries`, `issues` when the related campaign has
     `status = 'closed'`.
   - `CHECK` constraints listed inline in the design tables (date ranges, `role`/`client_id`,
     `kind`/`user_id`, `status`/`voided_at`, coordinates both-or-neither, quantity ranges).
3. `apps/api/prisma/CONSTRAINTS.md`: one row per hand-written constraint/trigger/index — name, table,
   rule it enforces (BR/FR id), and the test that covers it.
4. Verify that `prisma migrate dev` reports no drift after both migrations.

### Step 3 — Database module

- `apps/api/src/db/client.js`: a single PrismaClient using `@prisma/adapter-pg` and `DATABASE_URL`,
  explicit pool settings (max 10, connection timeout 5 s, idle timeout 30 s) because Prisma 7 adapters
  use the driver's defaults.
- `apps/api/src/db/transaction.js`: `withTransaction(fn, { isolationLevel = 'ReadCommitted', timeoutMs = 10000 })`
  wrapping Prisma interactive transactions; maps PostgreSQL errors to `AppError`s:
  unique violation `23505` → `ConflictError`, exclusion violation `23P01` → `ConflictError`,
  check violation `23514` → `BusinessRuleError`, FK violation `23503` → `BusinessRuleError`,
  raised exceptions from our triggers (`P0001`) → `BusinessRuleError` with the trigger message as `details.reason`.
  Export the mapper (`mapDbError`) so the global error handler can use it for non-transactional queries too.
- Graceful shutdown in `server.js` disconnects Prisma.
- `GET /api/v1/health` now includes `db: 'up' | 'down'` and returns 503 when the database is down.

### Step 4 — Seed (reference data only)

- `apps/api/prisma/seed/index.js`, run by `npm run db:seed`, idempotent (upserts).
- One agency from env: `SEED_AGENCY_NAME`, `SEED_AGENCY_CODE`.
- 69 wilayas and 1,541 communes with Arabic and English/Latin names, per Law 26-06
  (Journal Officiel n° 25 of 5 April 2026). Store the data as JSON in `apps/api/prisma/seed/data/`.
  You may derive it from an open dataset (for example the `geoalgeria` npm package) **only after checking
  its licence permits redistribution**; record the source and licence in `seed/data/SOURCE.md`; do not add
  it as a runtime dependency. If you cannot obtain a dataset with a compatible licence, stop and report.
- The seed asserts the counts (69 / 1,541) and fails loudly otherwise.
- No users, no campaigns, no demo data in this prompt.

## 4. Technical Requirements

- Prisma 7.x pinned (`~7.x`). PostgreSQL extensions `citext`, `pgcrypto` (if needed for
  `gen_random_uuid` on the server version), `btree_gist` created in the first migration.
- Scripts in `apps/api/package.json` and proxied from root: `db:generate`, `db:migrate`,
  `db:migrate:deploy`, `db:reset`, `db:seed`, `db:studio`. Update `CLAUDE.md` §10.
- Test database: a Vitest global setup runs `migrate deploy` against `DATABASE_URL_TEST`; a helper
  truncates all business tables (not wilayas/communes) between test files.

## 5. Database Changes

Everything in `docs/04-database-design.md` plus the approved adjustments in Step 1.

## 6. API Requirements

Only the health change in Step 3. No business endpoints.

## 7. Frontend Requirements

The health card shows the database status (`db: up/down`) with translations. Nothing else.

## 8. Business Rules (enforced at database level in this prompt)

| Rule | Mechanism |
| --- | --- |
| FR-012 / BR-02: no overlapping reporting lines per user; one open line | exclusion constraint + partial unique index |
| BR-13 / Q-08: an Animateur cannot have overlapping proposed/approved assignments | exclusion constraint |
| BR-41: holder, warehouse and in-transit balances never negative | CHECK on `stock_balances` |
| BR-40: ledger and audit log are append-only | `forbid_mutation` triggers |
| Double entry: each movement line's ledger entries sum to zero at commit | deferred constraint trigger |
| BR-14: at most one draft rule set per campaign | partial unique index |
| Q-11: one customer per phone per campaign | partial unique index |
| BR-50: entry number unique per tombola | unique constraint |
| BR-51: tombola entries and winners frozen after the draw | `tombola_locked` trigger |
| BR-15: no field data on a closed campaign | `campaign_closed_guard` trigger |

## 9. Security Requirements

- `DATABASE_URL` only from env; never logged (add it to logger redaction if it can appear).
- Dev database bound to `127.0.0.1`.
- No raw SQL built by string concatenation; use tagged `$queryRaw`/`$executeRaw` only.

## 10. Validation & Error Handling

- `mapDbError` covers the codes in Step 3; any other database error becomes a 500 with the original
  error logged (not returned).
- Seed failures exit with a non-zero code and a clear message.

## 11. Testing Requirements

`apps/api/src/db/__tests__/constraints.test.js` — one test per row of the table in section 8, each
proving the database **rejects** the forbidden state and **accepts** the nearest valid one, e.g.:
- two assignments for the same Animateur on overlapping dates → rejected; adjacent dates → accepted;
  overlapping but one `cancelled` → accepted;
- moving 5 units out of a holder with balance 3 → rejected; with balance 5 → accepted;
- `UPDATE`/`DELETE` on `stock_ledger_entries` and `audit_logs` → rejected;
- a ledger line with entries −5 / +4 → rejected at commit; −5 / +5 → accepted;
- second draft rule set → rejected; second approved → accepted;
- insert into `sales` for a closed campaign → rejected;
- insert into `tombola_entries` after `drawn` → rejected.

Also: `mapDbError` unit tests per error code; health returns 503 when the DB URL is unreachable;
seed is idempotent (run twice, counts unchanged) and asserts 69 / 1,541.

Create the minimal rows each test needs with small local factory helpers in
`apps/api/src/db/__tests__/factories.js` (not in application code).

## 12. Acceptance Criteria

- [ ] Step 0 report written; generation works with `npm run db:generate`; no `.ts` source committed.
- [ ] `npm run db:migrate` applies both migrations on a clean database; no drift reported.
- [ ] All 52 tables, enums, FKs, uniques and indexes from the design exist (verify with a query on
      `information_schema` / `pg_indexes` in a test or script, not by eye).
- [ ] Every row of section 8 has a passing test.
- [ ] `npm run db:seed` loads 1 agency, 69 wilayas, 1,541 communes and is idempotent.
- [ ] Health shows `db: up`, and 503 with `db: down` when PostgreSQL is stopped.
- [ ] `npm run lint` and `npm test` pass; CI runs migrations against the PostgreSQL service.

## 13. Expected Deliverables

- `apps/api/prisma/` — `schema.prisma`, `prisma.config.*`, migrations, `CONSTRAINTS.md`, `README.md`,
  `seed/` with data and `SOURCE.md`.
- `apps/api/src/db/` — `client.js`, `transaction.js`, tests, factories.
- Updated health endpoint, web health card, scripts, CI, `CLAUDE.md` §10.
- Final report: Prisma generation approach, any place where you had to interpret the design (quote the
  section and explain), constraint list with test names, dataset source and licence, verification steps.

Stop after the report. Do not start Prompt 03.
