-- Preserve legacy labels in descriptions before removing the separate field.
UPDATE "device_type_interfaces"
SET "description" = CASE
	WHEN "description" IS NULL OR btrim("description") = '' THEN "label"
	WHEN btrim("description") = btrim("label") THEN "description"
	ELSE "description" || ' | ' || "label"
END
WHERE "label" IS NOT NULL AND btrim("label") <> '';--> statement-breakpoint
ALTER TABLE "device_type_interfaces" DROP COLUMN "label";
