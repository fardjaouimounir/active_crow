BEGIN;

CREATE TABLE "field_interactions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "campaign_id" UUID NOT NULL REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "assignment_id" UUID NOT NULL REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "animateur_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "point_of_sale_id" UUID NOT NULL REFERENCES "points_of_sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "work_date" DATE NOT NULL,
  "kind" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_by" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "field_interactions_kind_check" CHECK ("kind" IN ('sample', 'tasting', 'information')),
  CONSTRAINT "field_interactions_count_check" CHECK ("count" BETWEEN 1 AND 500)
);

CREATE INDEX "field_interactions_campaign_id_work_date_idx"
  ON "field_interactions" ("campaign_id", "work_date");
CREATE INDEX "field_interactions_animateur_id_work_date_idx"
  ON "field_interactions" ("animateur_id", "work_date");
CREATE TRIGGER "field_interactions_append_only"
  BEFORE UPDATE OR DELETE ON "field_interactions"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

COMMIT;
