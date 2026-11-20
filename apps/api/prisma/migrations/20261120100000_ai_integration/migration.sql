BEGIN;

-- ai_requests: FieldFlow's own record of what it asked the AI service (never sent as such).
CREATE TABLE "ai_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "capability" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "filters" JSONB NOT NULL,
    "label_map" JSONB NOT NULL DEFAULT '{}',
    "payload_hash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "requested_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "ai_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_requests_status_check"
      CHECK ("status" IN ('queued', 'sent', 'send_failed', 'completed')),
    CONSTRAINT "ai_requests_capability_check"
      CHECK ("capability" IN ('supervisor_daily_summary', 'sales_performance', 'campaign_insights', 'animateur_coaching'))
);

CREATE UNIQUE INDEX "ai_requests_request_id_key" ON "ai_requests"("request_id");
CREATE INDEX "ai_requests_status_created_at_idx" ON "ai_requests"("status", "created_at");
CREATE INDEX "ai_requests_capability_subject_id_idx" ON "ai_requests"("capability", "subject_id");

ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_requested_by_fkey"
  FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ai_suggestions (created by the initial migration, never written before this one).
ALTER TABLE "ai_suggestions" ALTER COLUMN "request_id" TYPE UUID USING "request_id"::uuid;
ALTER TABLE "ai_suggestions" ADD COLUMN "review_note" TEXT;
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "ai_requests"("request_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only except the review fields, and a review happens once, from pending_review.
CREATE FUNCTION ai_suggestions_review_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending_review' THEN
    RAISE EXCEPTION 'ai_suggestions row % was already reviewed', OLD.id
      USING ERRCODE = '23514', CONSTRAINT = 'ai_suggestions_review_only';
  END IF;
  IF NEW.status = 'pending_review'
     OR (to_jsonb(NEW) - 'status' - 'reviewed_by' - 'reviewed_at' - 'review_note' - 'updated_at')
        IS DISTINCT FROM
        (to_jsonb(OLD) - 'status' - 'reviewed_by' - 'reviewed_at' - 'review_note' - 'updated_at') THEN
    RAISE EXCEPTION 'ai_suggestions only allows a review (status, reviewed_by, reviewed_at, review_note)'
      USING ERRCODE = '23514', CONSTRAINT = 'ai_suggestions_review_only';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ai_suggestions_review_only" BEFORE UPDATE ON "ai_suggestions"
  FOR EACH ROW EXECUTE FUNCTION ai_suggestions_review_only();
CREATE TRIGGER "ai_suggestions_no_delete" BEFORE DELETE ON "ai_suggestions"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

COMMIT;
