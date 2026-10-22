ALTER TABLE "attachments" DROP CONSTRAINT "attachments_owner_check";--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "rack_id" integer;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_rack_id_racks_id_fk" FOREIGN KEY ("rack_id") REFERENCES "public"."racks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_rack_id_idx" ON "attachments" USING btree ("rack_id");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_floorplan_owner_check" CHECK ("attachments"."rack_id" IS NULL OR "attachments"."is_floorplan" = 0);--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_owner_check" CHECK (num_nonnulls("attachments"."site_id", "attachments"."location_id", "attachments"."rack_id") = 1);