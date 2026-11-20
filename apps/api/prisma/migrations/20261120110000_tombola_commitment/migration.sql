BEGIN;

-- The commitment: published when registration closes, so the eligible list cannot change unseen.
ALTER TABLE "tombolas" ADD COLUMN "entries_hash" TEXT,
  ADD COLUMN "eligible_count" INTEGER,
  ADD COLUMN "committed_at" TIMESTAMPTZ(6);

-- The draw reveals its inputs: server_random is stored with the draw, never earlier.
ALTER TABLE "tombola_draws" ADD COLUMN "server_random" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "client_nonce" TEXT NOT NULL DEFAULT '';

-- Unreachable winners and the reserve that serves their rank (E-15).
ALTER TABLE "tombola_winners" ADD COLUMN "unreachable_reason" TEXT,
  ADD COLUMN "serves_rank" INTEGER;
ALTER TABLE "tombola_winners" ADD CONSTRAINT "tombola_winners_serves_rank_reserve"
  CHECK ("serves_rank" IS NULL OR "is_reserve");
ALTER TABLE "tombola_winners" ADD CONSTRAINT "tombola_winners_unreachable_reason"
  CHECK (("delivery_status" = 'unreachable') = ("unreachable_reason" IS NOT NULL));

-- SHA-256 (hex) of "<entry_number>" + newline for every valid entry, ascending (the shared draw
-- function computes the same value).
CREATE FUNCTION tombola_entries_digest(p_tombola_id uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(
    coalesce(string_agg(entry_number::text || E'\n', '' ORDER BY entry_number), ''), 'UTF8')), 'hex')
  FROM tombola_entries WHERE tombola_id = p_tombola_id AND status = 'valid'
$$;

-- Existing closed or drawn tombolas get their commitment before the guard exists.
UPDATE "tombolas" SET
  "entries_hash" = tombola_entries_digest("id"),
  "eligible_count" = (SELECT count(*) FROM "tombola_entries" e
    WHERE e."tombola_id" = "tombolas"."id" AND e."status" = 'valid'),
  "committed_at" = "updated_at"
WHERE "status" IN ('closed', 'drawn');

CREATE FUNCTION tombola_commitment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'open' AND NEW.status = 'closed' THEN
    NEW.entries_hash := tombola_entries_digest(NEW.id);
    NEW.eligible_count := (SELECT count(*) FROM tombola_entries
      WHERE tombola_id = NEW.id AND status = 'valid');
    NEW.committed_at := clock_timestamp();
  ELSIF NEW.status = 'open' AND OLD.status <> 'open' THEN
    RAISE EXCEPTION 'A closed tombola cannot be reopened'
      USING ERRCODE = '23514', CONSTRAINT = 'tombola_commitment';
  ELSIF NEW.entries_hash IS DISTINCT FROM OLD.entries_hash
     OR NEW.eligible_count IS DISTINCT FROM OLD.eligible_count
     OR NEW.committed_at IS DISTINCT FROM OLD.committed_at THEN
    RAISE EXCEPTION 'The tombola commitment cannot change'
      USING ERRCODE = '23514', CONSTRAINT = 'tombola_commitment';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tombola_commitment" BEFORE UPDATE ON "tombolas"
  FOR EACH ROW EXECUTE FUNCTION tombola_commitment();

-- Once registration is closed (committed) the entry list is frozen, drawn or not.
CREATE FUNCTION tombola_entries_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.tombola_id ELSE NEW.tombola_id END;
BEGIN
  PERFORM 1 FROM tombolas WHERE id = v_id FOR SHARE;
  IF EXISTS (SELECT 1 FROM tombolas WHERE id = v_id AND status <> 'open') THEN
    RAISE EXCEPTION '% on tombola_entries rejected: registration is closed', TG_OP
      USING ERRCODE = '23514', CONSTRAINT = 'tombola_entries_frozen';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tombola_entries_frozen" BEFORE INSERT OR UPDATE OR DELETE ON "tombola_entries"
  FOR EACH ROW EXECUTE FUNCTION tombola_entries_frozen();

-- A draw can only be inserted for a closed tombola, on exactly the committed list.
CREATE FUNCTION tombola_draw_matches_commitment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tombolas WHERE id = NEW.tombola_id AND status = 'closed'
      AND entries_hash = NEW.entries_hash AND eligible_count = NEW.eligible_count
      AND entries_hash = tombola_entries_digest(NEW.tombola_id)
  ) THEN
    RAISE EXCEPTION 'The draw does not match the committed entry list'
      USING ERRCODE = '23514', CONSTRAINT = 'tombola_draw_matches_commitment';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "tombola_draw_matches_commitment" BEFORE INSERT ON "tombola_draws"
  FOR EACH ROW EXECUTE FUNCTION tombola_draw_matches_commitment();

-- After the draw only delivery tracking and the promotion of a reserve may change.
CREATE OR REPLACE FUNCTION tombola_locked() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_tombola_ids uuid[];
  v_draw_ids uuid[];
  v_unlocked_columns text[] := ARRAY['delivery_status', 'delivered_at', 'unreachable_reason',
    'serves_rank', 'updated_at'];
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

COMMIT;
