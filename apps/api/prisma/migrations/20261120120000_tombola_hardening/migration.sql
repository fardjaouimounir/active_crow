BEGIN;

-- The draw row (seed, server random, nonce, commitment, who drew) never changes after the draw.
CREATE TRIGGER "tombola_draws_append_only" BEFORE UPDATE OR DELETE ON "tombola_draws"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- A Tombola moves open -> closed (commitment set) -> drawn, nothing else: no skipping the
-- commitment, no leaving the drawn state.
CREATE OR REPLACE FUNCTION tombola_commitment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'open' AND NEW.status = 'closed' THEN
    NEW.entries_hash := tombola_entries_digest(NEW.id);
    NEW.eligible_count := (SELECT count(*) FROM tombola_entries
      WHERE tombola_id = NEW.id AND status = 'valid');
    NEW.committed_at := clock_timestamp();
  ELSIF OLD.status IS DISTINCT FROM NEW.status
     AND NOT (OLD.status = 'closed' AND NEW.status = 'drawn') THEN
    RAISE EXCEPTION 'Invalid tombola status change % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514', CONSTRAINT = 'tombola_commitment';
  ELSIF NEW.entries_hash IS DISTINCT FROM OLD.entries_hash
     OR NEW.eligible_count IS DISTINCT FROM OLD.eligible_count
     OR NEW.committed_at IS DISTINCT FROM OLD.committed_at THEN
    RAISE EXCEPTION 'The tombola commitment cannot change'
      USING ERRCODE = '23514', CONSTRAINT = 'tombola_commitment';
  END IF;
  RETURN NEW;
END $$;

-- Defence in depth: only these kinds can ever be shared with a client (never attendance photos).
ALTER TABLE "files" ADD CONSTRAINT "files_client_visible_kinds"
  CHECK ("visibility" <> 'client_visible' OR "kind" IN ('visit_photo', 'campaign_document'));

COMMIT;
