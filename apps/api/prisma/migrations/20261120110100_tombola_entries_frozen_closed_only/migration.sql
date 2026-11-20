-- tombola_entries_frozen covers the closed state only; a drawn tombola keeps answering with the
-- original BR-51 error of tombola_locked.
CREATE OR REPLACE FUNCTION tombola_entries_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.tombola_id ELSE NEW.tombola_id END;
BEGIN
  PERFORM 1 FROM tombolas WHERE id = v_id FOR SHARE;
  IF EXISTS (SELECT 1 FROM tombolas WHERE id = v_id AND status = 'closed') THEN
    RAISE EXCEPTION '% on tombola_entries rejected: registration is closed', TG_OP
      USING ERRCODE = '23514', CONSTRAINT = 'tombola_entries_frozen';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
