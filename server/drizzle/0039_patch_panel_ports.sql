ALTER TABLE "floorplan_placements" DROP CONSTRAINT "floorplan_placements_object_check";--> statement-breakpoint
DROP INDEX "device_type_interfaces_prefix_kind_idx";--> statement-breakpoint
DROP INDEX "interfaces_device_name_idx";--> statement-breakpoint
ALTER TABLE "device_type_interfaces" ADD COLUMN "side" text;--> statement-breakpoint
ALTER TABLE "device_type_interfaces" ADD COLUMN "positions" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "device_type_interfaces" ADD COLUMN "rear_stub_id" integer;--> statement-breakpoint
ALTER TABLE "device_type_interfaces" ADD COLUMN "rear_position" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "floorplan_placements" ADD COLUMN "interface_id" integer;--> statement-breakpoint
ALTER TABLE "interfaces" ADD COLUMN "side" text;--> statement-breakpoint
ALTER TABLE "interfaces" ADD COLUMN "positions" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "interfaces" ADD COLUMN "rear_port_id" integer;--> statement-breakpoint
ALTER TABLE "interfaces" ADD COLUMN "rear_port_position" integer;--> statement-breakpoint
ALTER TABLE "device_type_interfaces" ADD CONSTRAINT "device_type_interfaces_rear_stub_id_device_type_interfaces_id_fk" FOREIGN KEY ("rear_stub_id") REFERENCES "public"."device_type_interfaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floorplan_placements" ADD CONSTRAINT "floorplan_placements_interface_id_interfaces_id_fk" FOREIGN KEY ("interface_id") REFERENCES "public"."interfaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interfaces" ADD CONSTRAINT "interfaces_rear_port_id_interfaces_id_fk" FOREIGN KEY ("rear_port_id") REFERENCES "public"."interfaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_type_interfaces_rear_stub_id_idx" ON "device_type_interfaces" USING btree ("rear_stub_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interfaces_rear_port_position_idx" ON "interfaces" USING btree ("rear_port_id","rear_port_position");--> statement-breakpoint
ALTER TABLE "device_type_interfaces" ADD CONSTRAINT "device_type_interfaces_prefix_kind_idx" UNIQUE NULLS NOT DISTINCT("device_type_id","prefix","kind","side");--> statement-breakpoint
ALTER TABLE "floorplan_placements" ADD CONSTRAINT "floorplan_placements_interface_id_unique" UNIQUE("interface_id");--> statement-breakpoint
ALTER TABLE "interfaces" ADD CONSTRAINT "interfaces_device_name_idx" UNIQUE NULLS NOT DISTINCT("device_id","side","name");--> statement-breakpoint
ALTER TABLE "device_type_interfaces" ADD CONSTRAINT "device_type_interfaces_side_check" CHECK ("device_type_interfaces"."positions" >= 1 AND "device_type_interfaces"."rear_position" >= 1 AND ("device_type_interfaces"."side" IS NULL OR "device_type_interfaces"."side" IN ('front', 'rear')) AND ("device_type_interfaces"."positions" = 1 OR "device_type_interfaces"."side" IS NOT DISTINCT FROM 'rear') AND (("device_type_interfaces"."side" IS NOT DISTINCT FROM 'front') = ("device_type_interfaces"."rear_stub_id" IS NOT NULL)));--> statement-breakpoint
ALTER TABLE "floorplan_placements" ADD CONSTRAINT "floorplan_placements_object_check" CHECK (num_nonnulls("floorplan_placements"."rack_id", "floorplan_placements"."device_id", "floorplan_placements"."interface_id") = 1);--> statement-breakpoint
ALTER TABLE "interfaces" ADD CONSTRAINT "interfaces_side_check" CHECK ("interfaces"."positions" >= 1 AND ("interfaces"."side" IS NULL OR "interfaces"."side" IN ('front', 'rear')) AND ("interfaces"."positions" = 1 OR "interfaces"."side" IS NOT DISTINCT FROM 'rear') AND (("interfaces"."side" IS NOT DISTINCT FROM 'front') = ("interfaces"."rear_port_id" IS NOT NULL)) AND (("interfaces"."rear_port_id" IS NULL) = ("interfaces"."rear_port_position" IS NULL)) AND ("interfaces"."rear_port_position" IS NULL OR "interfaces"."rear_port_position" >= 1));--> statement-breakpoint
-- Built-in patch-panel role: adopt an existing role of the same name, else
-- create it. Its icon defaults to the patch-panel glyph.
UPDATE "device_roles" SET "key" = 'patch-panel' WHERE "id" = (SELECT min("id") FROM "device_roles" WHERE lower(trim("name")) = 'patch panel') AND NOT EXISTS (SELECT 1 FROM "device_roles" WHERE "key" = 'patch-panel');--> statement-breakpoint
INSERT INTO "device_roles" ("name", "key") SELECT 'Patch Panel', 'patch-panel' WHERE NOT EXISTS (SELECT 1 FROM "device_roles" WHERE "key" = 'patch-panel');--> statement-breakpoint
UPDATE "device_roles" SET "icon" = 'patch-panel' WHERE "key" = 'patch-panel' AND "icon" IS NULL;
