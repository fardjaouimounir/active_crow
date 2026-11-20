# Hand-written database constraints

Everything here lives in `migrations/*_db_constraints/migration.sql` unless the row names another
migration (the extensions are also created at the top of `*_init`). `schema.prisma` cannot express
these objects. Prisma ignores CHECK constraints, exclusion constraints, triggers and
partial/expression indexes when it diffs, so `prisma migrate dev` reports no drift. Hand-written
unique indexes that Prisma must know about (the two `NULLS NOT DISTINCT` ones and
`stock_movements_one_per_entitlement`) are also declared with `@unique` / `@@unique(..., map:)`.
Prisma matches them by name and columns and does not compare `NULLS NOT DISTINCT` or `WHERE`.

Test files (all in `src/db/__tests__/`): **C** = `constraints.test.js` (Prompt 02 §8 rules),
**K** = `checks.test.js`, **S** = `schema.test.js` (existence and definition of every object
below, checked through the PostgreSQL catalogs).

PostgreSQL errors map to API errors through `mapDbError`: 23505 / 23P01 → 409, 23514 / 23503 /
P0001 → 422.

## Extensions

| Name         | Why                                          | Test                                                  |
| ------------ | -------------------------------------------- | ----------------------------------------------------- |
| `citext`     | `users.email` is case-insensitive and unique | K › users.email is unique regardless of case (citext) |
| `btree_gist` | `=` on uuid inside the exclusion constraints | C › BR-13, FR-012 blocks                              |

`gen_random_uuid()` is built into PostgreSQL 13+, so `pgcrypto` is not installed.

## Business rules (Prompt 02 §8)

| Name                                                                                                                       | Table                                                                                  | Rule                                                                                                         | Test                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `reporting_lines_no_overlap` (EXCLUDE gist, `daterange(valid_from, valid_to, '[)')`)                                       | reporting_lines                                                                        | FR-012 / BR-02: no overlapping reporting periods per user                                                    | C › FR-012 / BR-02 › rejects an overlapping period · accepts an adjacent period                             |
| `reporting_lines_one_open` (partial unique, `WHERE valid_to IS NULL`)                                                      | reporting_lines                                                                        | FR-012: one open line per user                                                                               | C › FR-012 / BR-02 › rejects a second open line                                                             |
| `assignments_no_overlap` (EXCLUDE gist, `daterange(start_date, end_date, '[]')` `WHERE status IN ('proposed','approved')`) | assignments                                                                            | BR-13 / Q-08: one point of sale per day per Animateur, across campaigns                                      | C › BR-13 › rejects overlapping dates · in another campaign · accepts adjacent · accepts cancelled/rejected |
| `stock_balances_non_negative` (CHECK)                                                                                      | stock_balances                                                                         | BR-41: holder, warehouse and in-transit balances never negative (external/customers/losses are counterparts) | C › BR-41 › rejects 5 out of 3 · accepts 5 out of 5 · warehouse/in_transit · external/customers/losses      |
| `forbid_mutation()` + `stock_ledger_append_only` (BEFORE UPDATE OR DELETE)                                                 | stock_ledger_entries                                                                   | BR-40: ledger is append-only                                                                                 | C › BR-40 › stock_ledger_entries                                                                            |
| `forbid_mutation()` + `audit_logs_append_only` (BEFORE UPDATE OR DELETE)                                                   | audit_logs                                                                             | BR-40: audit log is append-only                                                                              | C › BR-40 › audit_logs                                                                                      |
| `check_line_balanced()` + `ledger_balanced` (CONSTRAINT TRIGGER, DEFERRABLE INITIALLY DEFERRED)                            | stock_ledger_entries                                                                   | Double entry: each movement line's entries sum to zero at COMMIT                                             | C › Double entry › rejects −5 / +4 at commit · accepts −5 / +5                                              |
| `rule_sets_one_draft` (partial unique, `WHERE status = 'draft'`)                                                           | rule_sets                                                                              | BR-14: at most one draft rule set per campaign                                                               | C › BR-14                                                                                                   |
| `customers_campaign_phone` (partial unique, `WHERE phone IS NOT NULL`)                                                     | customers                                                                              | Q-11: one customer per phone per campaign                                                                    | C › Q-11                                                                                                    |
| `tombola_entries_tombola_id_entry_number_key` (unique, from schema)                                                        | tombola_entries                                                                        | BR-50: entry number unique per tombola                                                                       | C › BR-50                                                                                                   |
| `tombola_locked()` + trigger `tombola_locked`                                                                              | tombola_entries, tombola_winners                                                       | BR-51: frozen after the draw (see below)                                                                     | C › BR-51 (4 tests)                                                                                         |
| `campaign_closed_guard()` + trigger `campaign_closed_guard` (BEFORE INSERT)                                                | attendance_records, sales, stock_movements, supervisor_visits, tombola_entries, issues | BR-15: no new field data on a closed campaign (second line of defence behind services)                       | C › BR-15 › accepts while active · rejects all six once closed                                              |

### `tombola_locked` and the draw ordering

Once the parent tombola has `status = 'drawn'`:

- `tombola_entries`: INSERT, UPDATE and DELETE are rejected.
- `tombola_winners`: INSERT and DELETE are rejected. UPDATE is rejected unless only
  `delivery_status`, `delivered_at` (and `updated_at`) change, because prize delivery is tracked
  after the draw.

**The draw service must, in one transaction:** lock the tombola row (`SELECT … FOR UPDATE`),
insert `tombola_draws`, insert every `tombola_winners` row, and set `tombolas.status = 'drawn'`
**last**. The trigger checks the parent's status, so it never blocks the draw itself. The trigger
also takes `FOR SHARE` on the parent tombola, so an entry insert running concurrently with a draw
waits for it and then sees `drawn`.

## Unique indexes Prisma cannot express

| Name                                                                                                                                                                  | Table           | Rule                                                                                                                                            | Test                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `clients_agency_name_active` (unique on `(agency_id, lower(name)) WHERE deleted_at IS NULL`)                                                                          | clients         | Design: client name unique per agency, case-insensitive, among non-deleted clients                                                              | K › clients_agency_name_active          |
| `promotion_tiers_unique` (`NULLS NOT DISTINCT`)                                                                                                                       | promotion_tiers | Design: `(promotion_id, product_id, min_quantity)` unique; NULL product = "any product" counts as a value                                       | K › promotion_tiers_unique              |
| `stock_locations_unique` (`NULLS NOT DISTINCT`)                                                                                                                       | stock_locations | Design: one fixed location of each kind per campaign (`user_id` NULL)                                                                           | K › stock_locations_unique              |
| `stock_movements_one_per_entitlement` (partial unique on `gift_entitlement_id WHERE gift_entitlement_id IS NOT NULL`; migration `*_one_distribution_per_entitlement`) | stock_movements | One entitlement, one distribution: an entitlement is fulfilled by at most one movement, which prevents deducting the same gift from stock twice | K › stock_movements_one_per_entitlement |

## Partial indexes (performance, from the design)

| Name                                                                        | Table              | Purpose                               | Test                                              |
| --------------------------------------------------------------------------- | ------------------ | ------------------------------------- | ------------------------------------------------- |
| `attendance_pending` (`WHERE status = 'pending'`)                           | attendance_records | Supervisor review queue               | S › has the hand-written index attendance_pending |
| `entitlements_undelivered` (`WHERE status = 'undelivered'`)                 | gift_entitlements  | E-02 "earned but not delivered" board | S › … entitlements_undelivered                    |
| `notifications_unread` (`(user_id, created_at DESC) WHERE read_at IS NULL`) | notifications      | Unread notification list              | S › … notifications_unread                        |

## CHECK constraints from the design tables

| Name                                       | Table                | Rule                                                          | Test                                             |
| ------------------------------------------ | -------------------- | ------------------------------------------------------------- | ------------------------------------------------ |
| `agencies_code_format`                     | agencies             | `code ~ '^[A-Z0-9-]{2,20}$'`                                  | K › agencies_code_format                         |
| `users_client_role`                        | users                | `(role = 'client') = (client_id IS NOT NULL)`                 | K › users_client_role                            |
| `wilayas_id_range`                         | wilayas              | Official code 1–69 (Law 26-06)                                | K › wilayas_id_range                             |
| `reporting_lines_not_self`                 | reporting_lines      | `manager_id <> user_id`                                       | K › reporting_lines_not_self and …               |
| `reporting_lines_valid_range`              | reporting_lines      | `valid_to IS NULL OR valid_to >= valid_from`                  | K › … reporting_lines_valid_range                |
| `points_of_sale_coordinates`               | points_of_sale       | latitude and longitude both or neither                        | K › points_of_sale_coordinates                   |
| `campaigns_date_range`                     | campaigns            | `end_date >= start_date`                                      | K › campaigns_date_range and …                   |
| `campaigns_approver_role`                  | campaigns            | Q-09: approver ∈ director, general_manager, regional_manager  | K › … campaigns_approver_role                    |
| `campaign_wilayas_required_non_negative`   | campaign_wilayas     | `required_animateurs >= 0`                                    | K › campaign_wilayas_required_non_negative       |
| `promotion_tiers_min_quantity_positive`    | promotion_tiers      | `min_quantity > 0`                                            | K › promotion_tiers_min_quantity_positive and …  |
| `promotion_tiers_gift_quantity_positive`   | promotion_tiers      | `gift_quantity > 0`                                           | K › … promotion_tiers_gift_quantity_positive     |
| `assignments_date_range`                   | assignments          | `end_date >= start_date`                                      | K › assignments_date_range                       |
| `assignments_shift_pair`                   | assignments          | shift_start and shift_end both or neither                     | K › assignments_shift_pair                       |
| `assignments_work_days_iso`                | assignments          | `work_days` ⊆ {1..7} (ISO weekdays) or NULL                   | K › assignments_work_days_iso                    |
| `attendance_records_coordinates`           | attendance_records   | latitude and longitude both or neither                        | K › attendance_records_coordinates and …         |
| `supervisor_visits_coordinates`            | supervisor_visits    | latitude and longitude both or neither                        | K › … supervisor_visits_coordinates              |
| `sales_voided_consistency`                 | sales                | `(status = 'voided') = (voided_at IS NOT NULL)`               | K › sales_voided_consistency                     |
| `sale_items_quantity_positive`             | sale_items           | `quantity > 0`                                                | K › sale_items_quantity_positive and …           |
| `gift_entitlements_quantity_positive`      | gift_entitlements    | `quantity > 0`                                                | K › … gift_entitlements_quantity_positive        |
| `stock_locations_holder_user`              | stock_locations      | `(kind = 'holder') = (user_id IS NOT NULL)`                   | K › stock_locations_holder_user                  |
| `stock_movements_distinct_locations`       | stock_movements      | `from_location_id <> to_location_id`                          | K › stock_movements_distinct_locations           |
| `stock_movements_distribution_entitlement` | stock_movements      | `(type = 'distribution') = (gift_entitlement_id IS NOT NULL)` | K › stock_movements_distribution_entitlement     |
| `stock_movement_lines_quantity_positive`   | stock_movement_lines | `quantity > 0`                                                | K › stock_movement_lines_quantity_positive and … |
| `stock_movement_lines_received_range`      | stock_movement_lines | `quantity_received BETWEEN 0 AND quantity`                    | K › … stock_movement_lines_received_range        |
| `stock_ledger_entries_delta_non_zero`      | stock_ledger_entries | `quantity_delta <> 0`                                         | K › stock_ledger_entries_delta_non_zero          |
| `tombolas_counts`                          | tombolas             | `winners_count > 0 AND reserves_count >= 0`                   | K › tombolas_counts                              |

## Adding a constraint

1. `npm run db:migrate -- --create-only --name <name>` and write the SQL by hand.
2. Add a row here, and a test that proves the database rejects the forbidden state and accepts the
   nearest valid one. Also add the object to the expected lists in `schema.test.js`.
3. Run `npm run db:migrate`: it must report no drift.

### Organization migration

The organization migration adds `is_demo BOOLEAN NOT NULL DEFAULT false` to `regions` and `points_of_sale`. A reporting line closed on its creation day is retained as an empty half-open interval. It remains in history and does not overlap the replacement line.

### Issue comment attachments migration

Migration `20261120050000_issue_comment_attachments` adds the nullable UUID `issue_attachments.comment_id`. The composite foreign key `issue_attachments_issue_id_comment_id_fkey` references `issue_comments(issue_id, id)` and prevents attaching a file to a comment from a different issue. `issue_comments_issue_id_id_key` supplies the referenced unique pair, and `issue_attachments_issue_id_comment_id_idx` supports lookups by issue and comment. Existing rows with a null comment remain direct issue attachments.

### Absence voiding migration

`absences_void_consistent` requires the timestamp, actor and reason to be present together. The unique index `absences_one_active_per_day` covers `(assignment_id, work_date)` where `voided_at IS NULL`. This preserves voided rows and permits a corrected absence on the same day.

### Sales migrations

`field_interactions_kind_check` and `field_interactions_count_check` constrain counted batches. The `field_interactions_append_only` trigger uses the existing `forbid_mutation` function for updates and deletes.

`issues_one_open_shortage_per_assignment_item` enforces one open or in-progress stock shortage issue per assignment and stock item. The `gift_entitlements_shortage_issue_immutable` trigger preserves the original nullable `shortage_issue_id` once assigned, including after delivery or void.

### AI integration migration

`ai_requests` (ours, never sent to the AI service) has `ai_requests_status_check` (`queued`, `sent`, `send_failed`, `completed`) and `ai_requests_capability_check` (the four capability ids). `ai_suggestions.request_id` becomes `uuid` with the foreign key `ai_suggestions_request_id_fkey` to `ai_requests(request_id)`, so a suggestion exists only for a request we made. The trigger `ai_suggestions_review_only` allows an update only while the row is `pending_review`, only to `accepted` or `rejected`, and only on `status`, `reviewed_by`, `reviewed_at`, `review_note` (and the housekeeping `updated_at`); `ai_suggestions_no_delete` forbids deletes.

### Tombola commitment migrations

`tombola_commitment()` (BEFORE UPDATE on `tombolas`) sets `entries_hash` (SHA-256 of `"<n>\n"` per valid entry, ascending), `eligible_count` and `committed_at` when the status goes `open` → `closed`, rejects any later change of these columns and any reopening. `tombola_entries_frozen()` rejects INSERT, UPDATE and DELETE on `tombola_entries` while the Tombola is `closed` (when `drawn`, `tombola_locked` answers as before). `tombola_draw_matches_commitment()` (BEFORE INSERT on `tombola_draws`) requires a `closed` Tombola whose commitment equals the draw's `entries_hash` and `eligible_count` and the current list. `tombola_locked()` now also lets `unreachable_reason` and `serves_rank` change after the draw. Checks `tombola_winners_serves_rank_reserve` (only a reserve serves a rank) and `tombola_winners_unreachable_reason` (a reason iff `unreachable`). New columns: `tombolas.entries_hash/eligible_count/committed_at`, `tombola_draws.server_random/client_nonce`, `tombola_winners.unreachable_reason/serves_rank`.

### Tombola hardening migration

`tombola_draws_append_only` (BEFORE UPDATE OR DELETE on `tombola_draws`, `forbid_mutation()`): a draw never changes. `tombola_commitment()` now allows only `open → closed` (commitment set) and `closed → drawn`. `files_client_visible_kinds` (CHECK on `files`): `client_visible` only for `visit_photo` and `campaign_document`.
