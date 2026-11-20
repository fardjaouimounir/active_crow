BEGIN;

CREATE FUNCTION preserve_shortage_issue_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.shortage_issue_id IS NOT NULL
     AND NEW.shortage_issue_id IS DISTINCT FROM OLD.shortage_issue_id THEN
    RAISE EXCEPTION 'The original shortage issue link cannot change'
      USING ERRCODE = '23514', CONSTRAINT = 'gift_entitlements_shortage_issue_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER gift_entitlements_shortage_issue_immutable
  BEFORE UPDATE OF shortage_issue_id ON gift_entitlements
  FOR EACH ROW EXECUTE FUNCTION preserve_shortage_issue_link();

COMMIT;
