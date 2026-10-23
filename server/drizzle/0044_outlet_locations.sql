ALTER TABLE "interfaces" ADD COLUMN "location_id" integer;--> statement-breakpoint
ALTER TABLE "interfaces" ADD CONSTRAINT "interfaces_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interfaces_location_id_idx" ON "interfaces" USING btree ("location_id");--> statement-breakpoint
ALTER TABLE "interfaces" ADD CONSTRAINT "interfaces_location_check" CHECK ("interfaces"."location_id" IS NULL OR ("interfaces"."side" IS NOT DISTINCT FROM 'rear' AND "interfaces"."positions" = 1));--> statement-breakpoint
-- Outlets already placed on a location's floor plan start in that location.
UPDATE "interfaces" i SET "location_id" = a."location_id"
FROM "floorplan_placements" fp
JOIN "attachments" a ON a."id" = fp."attachment_id"
WHERE fp."interface_id" = i."id" AND a."location_id" IS NOT NULL;
