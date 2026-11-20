BEGIN;

ALTER TABLE "issues"
  ADD COLUMN "assignment_id" UUID,
  ADD CONSTRAINT "issues_assignment_id_fkey"
    FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "issues_assignment_id_idx" ON "issues" ("assignment_id");

ALTER TABLE "gift_entitlements"
  ADD COLUMN "shortage_issue_id" UUID,
  ADD CONSTRAINT "gift_entitlements_shortage_issue_id_fkey"
    FOREIGN KEY ("shortage_issue_id") REFERENCES "issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "gift_entitlements_shortage_issue_id_idx" ON "gift_entitlements" ("shortage_issue_id");

CREATE UNIQUE INDEX "issues_one_open_shortage_per_assignment_item"
  ON "issues" ("assignment_id", "stock_item_id")
  WHERE "category" = 'stock_shortage'
    AND "status" IN ('open', 'in_progress')
    AND "assignment_id" IS NOT NULL;

COMMIT;
