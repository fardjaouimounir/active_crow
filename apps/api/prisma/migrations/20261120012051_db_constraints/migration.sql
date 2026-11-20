-- Hand-written migration: everything schema.prisma cannot express.
-- Every object here is listed in prisma/CONSTRAINTS.md with the rule it enforces and its test.

-- ═══ A. docs/04-database-design.md, section "القيود والفهارس الحرجة بـ SQL يدوي" (verbatim) ═══

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- BR-01 / FR-012: لا تداخل في التبعية
ALTER TABLE reporting_lines ADD CONSTRAINT reporting_lines_no_overlap
  EXCLUDE USING gist (user_id WITH =, daterange(valid_from, valid_to, '[)') WITH &&);
CREATE UNIQUE INDEX reporting_lines_one_open ON reporting_lines (user_id) WHERE valid_to IS NULL;

-- BR-13 / Q-08: محل واحد في اليوم عبر كل الحملات
ALTER TABLE assignments ADD CONSTRAINT assignments_no_overlap
  EXCLUDE USING gist (animateur_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
  WHERE (status IN ('proposed', 'approved'));

-- BR-41: لا رصيد سالب لدى أي حائز
ALTER TABLE stock_balances ADD CONSTRAINT stock_balances_non_negative
  CHECK (location_kind IN ('external', 'customers', 'losses') OR quantity >= 0);

-- BR-40: الدفاتر لا تُعدَّل ولا تُحذف
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
CREATE TRIGGER stock_ledger_append_only BEFORE UPDATE OR DELETE ON stock_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- القيد المزدوج: مجموع قيود كل سطر حركة = 0 عند Commit
CREATE FUNCTION check_line_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT sum(quantity_delta) FROM stock_ledger_entries
      WHERE movement_line_id = NEW.movement_line_id) <> 0 THEN
    RAISE EXCEPTION 'unbalanced ledger for line %', NEW.movement_line_id;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_balanced AFTER INSERT ON stock_ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_line_balanced();

-- فهارس جزئية
CREATE UNIQUE INDEX rule_sets_one_draft ON rule_sets (campaign_id) WHERE status = 'draft';
CREATE UNIQUE INDEX customers_campaign_phone ON customers (campaign_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX attendance_pending ON attendance_records (campaign_id) WHERE status = 'pending';
CREATE INDEX entitlements_undelivered ON gift_entitlements (campaign_id) WHERE status = 'undelivered';
CREATE INDEX notifications_unread ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

-- ═══ B. Unique constraints from the design tables that Prisma cannot express ═══

-- clients: UNIQUE (agency_id, lower(name)) WHERE deleted_at IS NULL
CREATE UNIQUE INDEX clients_agency_name_active ON clients (agency_id, lower(name))
  WHERE deleted_at IS NULL;

-- The next two are declared with @@unique in schema.prisma (so Prisma sees no drift) and are
-- recreated here as NULLS NOT DISTINCT, which Prisma cannot express.

-- promotion_tiers: UNIQUE (promotion_id, product_id, min_quantity); product_id NULL means
-- "any product", so two NULL tiers with the same min_quantity are duplicates too.
DROP INDEX promotion_tiers_unique;
CREATE UNIQUE INDEX promotion_tiers_unique ON promotion_tiers (promotion_id, product_id, min_quantity)
  NULLS NOT DISTINCT;

-- stock_locations: UNIQUE (campaign_id, kind, user_id) NULLS NOT DISTINCT
DROP INDEX stock_locations_unique;
CREATE UNIQUE INDEX stock_locations_unique ON stock_locations (campaign_id, kind, user_id)
  NULLS NOT DISTINCT;

-- ═══ C. CHECK constraints listed inline in the design tables ═══

ALTER TABLE agencies ADD CONSTRAINT agencies_code_format
  CHECK (code ~ '^[A-Z0-9-]{2,20}$');

ALTER TABLE users ADD CONSTRAINT users_client_role
  CHECK ((role = 'client') = (client_id IS NOT NULL));

ALTER TABLE wilayas ADD CONSTRAINT wilayas_id_range
  CHECK (id BETWEEN 1 AND 69);

ALTER TABLE reporting_lines ADD CONSTRAINT reporting_lines_not_self
  CHECK (manager_id <> user_id);
ALTER TABLE reporting_lines ADD CONSTRAINT reporting_lines_valid_range
  CHECK (valid_to IS NULL OR valid_to > valid_from);

ALTER TABLE points_of_sale ADD CONSTRAINT points_of_sale_coordinates
  CHECK ((latitude IS NULL) = (longitude IS NULL));

ALTER TABLE campaigns ADD CONSTRAINT campaigns_date_range
  CHECK (end_date >= start_date);
ALTER TABLE campaigns ADD CONSTRAINT campaigns_approver_role
  CHECK (assignment_approver_role IN ('director', 'general_manager', 'regional_manager'));

ALTER TABLE campaign_wilayas ADD CONSTRAINT campaign_wilayas_required_non_negative
  CHECK (required_animateurs >= 0);

ALTER TABLE promotion_tiers ADD CONSTRAINT promotion_tiers_min_quantity_positive
  CHECK (min_quantity > 0);
ALTER TABLE promotion_tiers ADD CONSTRAINT promotion_tiers_gift_quantity_positive
  CHECK (gift_quantity > 0);

ALTER TABLE assignments ADD CONSTRAINT assignments_date_range
  CHECK (end_date >= start_date);
ALTER TABLE assignments ADD CONSTRAINT assignments_shift_pair
  CHECK ((shift_start IS NULL) = (shift_end IS NULL));
ALTER TABLE assignments ADD CONSTRAINT assignments_work_days_iso
  CHECK (work_days IS NULL OR work_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]);

ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_coordinates
  CHECK ((latitude IS NULL) = (longitude IS NULL));

ALTER TABLE supervisor_visits ADD CONSTRAINT supervisor_visits_coordinates
  CHECK ((latitude IS NULL) = (longitude IS NULL));

ALTER TABLE sales ADD CONSTRAINT sales_voided_consistency
  CHECK ((status = 'voided') = (voided_at IS NOT NULL));

ALTER TABLE sale_items ADD CONSTRAINT sale_items_quantity_positive
  CHECK (quantity > 0);

ALTER TABLE gift_entitlements ADD CONSTRAINT gift_entitlements_quantity_positive
  CHECK (quantity > 0);

ALTER TABLE stock_locations ADD CONSTRAINT stock_locations_holder_user
  CHECK ((kind = 'holder') = (user_id IS NOT NULL));

ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_distinct_locations
  CHECK (from_location_id <> to_location_id);
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_distribution_entitlement
  CHECK ((type = 'distribution') = (gift_entitlement_id IS NOT NULL));

ALTER TABLE stock_movement_lines ADD CONSTRAINT stock_movement_lines_quantity_positive
  CHECK (quantity > 0);
ALTER TABLE stock_movement_lines ADD CONSTRAINT stock_movement_lines_received_range
  CHECK (quantity_received BETWEEN 0 AND quantity);

ALTER TABLE stock_ledger_entries ADD CONSTRAINT stock_ledger_entries_delta_non_zero
  CHECK (quantity_delta <> 0);

ALTER TABLE tombolas ADD CONSTRAINT tombolas_counts
  CHECK (winners_count > 0 AND reserves_count >= 0);

-- ═══ D. BR-51: entries and winners are frozen once the tombola is drawn ═══
-- The draw service inserts tombola_draws and tombola_winners first and sets
-- tombolas.status = 'drawn' last, in one transaction, so this trigger never blocks the draw.
-- After the draw, only tombola_winners.delivery_status / delivered_at (and updated_at) may change.
-- The parent tombola rows are locked FOR SHARE so an entry cannot slip in while a draw commits.

CREATE FUNCTION tombola_locked() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_tombola_ids uuid[];
  v_draw_ids uuid[];
  v_unlocked_columns text[] := ARRAY['delivery_status', 'delivered_at', 'updated_at'];
BEGIN
  IF TG_TABLE_NAME = 'tombola_entries' THEN
    IF TG_OP = 'INSERT' THEN
      v_tombola_ids := ARRAY[NEW.tombola_id];
    ELSIF TG_OP = 'UPDATE' THEN
      v_tombola_ids := ARRAY[OLD.tombola_id, NEW.tombola_id];
    ELSE
      v_tombola_ids := ARRAY[OLD.tombola_id];
    END IF;
  ELSE
    IF TG_OP = 'UPDATE'
       AND (to_jsonb(NEW) - v_unlocked_columns) = (to_jsonb(OLD) - v_unlocked_columns) THEN
      RETURN NEW; -- prize delivery tracking stays open after the draw
    END IF;
    IF TG_OP = 'INSERT' THEN
      v_draw_ids := ARRAY[NEW.draw_id];
    ELSIF TG_OP = 'UPDATE' THEN
      v_draw_ids := ARRAY[OLD.draw_id, NEW.draw_id];
    ELSE
      v_draw_ids := ARRAY[OLD.draw_id];
    END IF;
    SELECT array_agg(tombola_id) INTO v_tombola_ids FROM tombola_draws WHERE id = ANY (v_draw_ids);
  END IF;

  PERFORM 1 FROM tombolas WHERE id = ANY (v_tombola_ids) FOR SHARE;
  IF EXISTS (SELECT 1 FROM tombolas WHERE id = ANY (v_tombola_ids) AND status = 'drawn') THEN
    RAISE EXCEPTION '% on % rejected: the tombola is drawn (BR-51)', TG_OP, TG_TABLE_NAME;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tombola_locked BEFORE INSERT OR UPDATE OR DELETE ON tombola_entries
  FOR EACH ROW EXECUTE FUNCTION tombola_locked();
CREATE TRIGGER tombola_locked BEFORE INSERT OR UPDATE OR DELETE ON tombola_winners
  FOR EACH ROW EXECUTE FUNCTION tombola_locked();

-- ═══ E. BR-15: no new field data on a closed campaign (second line of defence behind services) ═══

CREATE FUNCTION campaign_closed_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_campaign_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'tombola_entries' THEN
    SELECT campaign_id INTO v_campaign_id FROM tombolas WHERE id = NEW.tombola_id;
  ELSE
    v_campaign_id := (to_jsonb(NEW) ->> 'campaign_id')::uuid;
  END IF;

  IF EXISTS (SELECT 1 FROM campaigns WHERE id = v_campaign_id AND status = 'closed') THEN
    RAISE EXCEPTION 'INSERT on % rejected: campaign % is closed (BR-15)', TG_TABLE_NAME, v_campaign_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER campaign_closed_guard BEFORE INSERT ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION campaign_closed_guard();
CREATE TRIGGER campaign_closed_guard BEFORE INSERT ON sales
  FOR EACH ROW EXECUTE FUNCTION campaign_closed_guard();
CREATE TRIGGER campaign_closed_guard BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION campaign_closed_guard();
CREATE TRIGGER campaign_closed_guard BEFORE INSERT ON supervisor_visits
  FOR EACH ROW EXECUTE FUNCTION campaign_closed_guard();
CREATE TRIGGER campaign_closed_guard BEFORE INSERT ON tombola_entries
  FOR EACH ROW EXECUTE FUNCTION campaign_closed_guard();
CREATE TRIGGER campaign_closed_guard BEFORE INSERT ON issues
  FOR EACH ROW EXECUTE FUNCTION campaign_closed_guard();
