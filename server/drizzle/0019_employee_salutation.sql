ALTER TABLE "employees" ADD COLUMN "salutation" text;--> statement-breakpoint
-- `gender` becomes the salutation: male -> Herr (`mr`), female -> Frau (`ms`).
UPDATE "employees" SET "salutation" = CASE "gender" WHEN 'male' THEN 'mr' WHEN 'female' THEN 'ms' END;--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "gender";--> statement-breakpoint
-- Snapshot rows carry `gender`; the next sync refetches all employees.
DELETE FROM "external_objects" WHERE "object_type" = 'employee';
