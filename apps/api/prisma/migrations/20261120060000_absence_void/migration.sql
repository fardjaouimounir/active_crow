BEGIN;

ALTER TABLE "absences"
  ADD COLUMN "voided_at" TIMESTAMPTZ(6),
  ADD COLUMN "voided_by" UUID,
  ADD COLUMN "void_reason" TEXT,
  ADD CONSTRAINT "absences_voided_by_fkey"
    FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "absences_void_consistent"
    CHECK (num_nonnulls("voided_at", "voided_by", "void_reason") IN (0, 3));

DROP INDEX "absences_assignment_id_work_date_key";
CREATE UNIQUE INDEX "absences_one_active_per_day"
  ON "absences" ("assignment_id", "work_date")
  WHERE "voided_at" IS NULL;

COMMIT;
