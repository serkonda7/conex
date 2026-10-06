ALTER TABLE "employees" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "gender" text;--> statement-breakpoint
-- Existing full names split at the last space: "Erika Mustermann" -> Erika / Mustermann.
UPDATE "employees" SET
	"first_name" = CASE WHEN btrim("name") ~ '\s' THEN regexp_replace(btrim("name"), '\s+\S+$', '') END,
	"last_name" = regexp_replace(btrim("name"), '^.*\s', '');--> statement-breakpoint
ALTER TABLE "employees" ALTER COLUMN "last_name" SET NOT NULL;--> statement-breakpoint
DROP INDEX "employees_name_idx";--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "name" text GENERATED ALWAYS AS (btrim(coalesce(first_name, '') || ' ' || last_name)) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "employees_name_idx" ON "employees" USING btree ("name");--> statement-breakpoint
-- Snapshot rows predate first/last name and gender; the next sync refetches all employees.
DELETE FROM "external_objects" WHERE "object_type" = 'employee';
