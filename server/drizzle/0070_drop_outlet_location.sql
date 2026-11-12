ALTER TABLE "interfaces" DROP CONSTRAINT "interfaces_location_check";--> statement-breakpoint
ALTER TABLE "interfaces" DROP CONSTRAINT "interfaces_location_id_locations_id_fk";
--> statement-breakpoint
DROP INDEX "interfaces_location_id_idx";--> statement-breakpoint
ALTER TABLE "interfaces" DROP COLUMN "location_id";