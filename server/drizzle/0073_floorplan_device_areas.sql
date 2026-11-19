ALTER TABLE "floorplan_areas" DROP CONSTRAINT "floorplan_areas_target_check";--> statement-breakpoint
ALTER TABLE "floorplan_areas" ADD COLUMN "device_id" integer;--> statement-breakpoint
ALTER TABLE "floorplan_areas" ADD CONSTRAINT "floorplan_areas_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floorplan_areas" ADD CONSTRAINT "floorplan_areas_device_id_unique" UNIQUE("device_id");--> statement-breakpoint
ALTER TABLE "floorplan_areas" ADD CONSTRAINT "floorplan_areas_target_check" CHECK (num_nonnulls("floorplan_areas"."site_id", "floorplan_areas"."location_id", "floorplan_areas"."device_id") = 1);