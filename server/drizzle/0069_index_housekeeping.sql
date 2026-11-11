DROP INDEX "cables_a_interface_id_idx";--> statement-breakpoint
DROP INDEX "cables_b_interface_id_idx";--> statement-breakpoint
DROP INDEX "device_roles_name_idx";--> statement-breakpoint
DROP INDEX "device_types_manufacturer_id_idx";--> statement-breakpoint
DROP INDEX "manufacturers_name_idx";--> statement-breakpoint
DROP INDEX "rack_types_manufacturer_id_idx";--> statement-breakpoint
DROP INDEX "service_levels_name_idx";--> statement-breakpoint
DROP INDEX "virtual_machines_host_device_id_idx";--> statement-breakpoint
CREATE INDEX "device_types_default_device_role_id_idx" ON "device_types" USING btree ("default_device_role_id");--> statement-breakpoint
CREATE INDEX "devices_location_id_idx" ON "devices" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "floorplan_areas_site_id_idx" ON "floorplan_areas" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "floorplan_areas_location_id_idx" ON "floorplan_areas" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "locations_tenant_id_idx" ON "locations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "racks_rack_type_id_idx" ON "racks" USING btree ("rack_type_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");