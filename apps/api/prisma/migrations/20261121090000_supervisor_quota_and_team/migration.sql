BEGIN;

-- The director sets how many Animateurs each supervisor must bring; the wilaya need becomes the sum.
ALTER TABLE "campaign_staff" ADD COLUMN "required_animateurs" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "campaign_staff"
  ADD CONSTRAINT "campaign_staff_required_animateurs_check"
  CHECK ("required_animateurs" >= 0 AND ("role" = 'supervisor' OR "required_animateurs" = 0));

-- Existing campaigns: give the whole wilaya need to its first supervisor so nothing is lost.
UPDATE "campaign_staff" cs
SET "required_animateurs" = cw."required_animateurs"
FROM "campaign_wilayas" cw
WHERE cs."role" = 'supervisor'
  AND cw."campaign_id" = cs."campaign_id" AND cw."wilaya_id" = cs."wilaya_id"
  AND cs."id" = (
    SELECT first."id" FROM "campaign_staff" first
    WHERE first."campaign_id" = cs."campaign_id" AND first."wilaya_id" = cs."wilaya_id"
      AND first."role" = 'supervisor'
    ORDER BY first."created_at", first."id" LIMIT 1);

CREATE TABLE "campaign_animateurs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "campaign_id" UUID NOT NULL,
  "supervisor_id" UUID NOT NULL,
  "animateur_id" UUID NOT NULL,
  "added_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "campaign_animateurs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "campaign_animateurs_campaign_id_animateur_id_key"
  ON "campaign_animateurs" ("campaign_id", "animateur_id");
CREATE INDEX "campaign_animateurs_campaign_id_supervisor_id_idx"
  ON "campaign_animateurs" ("campaign_id", "supervisor_id");
ALTER TABLE "campaign_animateurs"
  ADD CONSTRAINT "campaign_animateurs_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "campaign_animateurs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "campaign_animateurs_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "campaign_animateurs_animateur_id_fkey" FOREIGN KEY ("animateur_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "campaign_animateurs_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Animateurs that already have an assignment keep working: put them in their supervisor's team.
INSERT INTO "campaign_animateurs" ("agency_id","campaign_id","supervisor_id","animateur_id","added_by")
SELECT DISTINCT ON (a."campaign_id", a."animateur_id")
  a."agency_id", a."campaign_id", a."supervisor_id", a."animateur_id", a."proposed_by"
FROM "assignments" a
WHERE a."status" IN ('proposed','approved')
ORDER BY a."campaign_id", a."animateur_id", a."created_at";

COMMIT;
