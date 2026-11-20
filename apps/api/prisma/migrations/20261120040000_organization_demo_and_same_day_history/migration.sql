ALTER TABLE regions ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE points_of_sale ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT false;

-- Same-day history uses an empty half-open interval.
ALTER TABLE reporting_lines DROP CONSTRAINT reporting_lines_valid_range;
ALTER TABLE reporting_lines ADD CONSTRAINT reporting_lines_valid_range
  CHECK (valid_to IS NULL OR valid_to >= valid_from);
