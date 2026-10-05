ALTER TABLE "object_changes" ADD COLUMN "tenant_id" integer;--> statement-breakpoint
CREATE INDEX "object_changes_tenant_id_idx" ON "object_changes" USING btree ("tenant_id");--> statement-breakpoint
-- Backfill existing entries from their snapshots; shelves, interfaces and
-- cables resolve through their current parent rows where those still exist.
UPDATE "object_changes" SET "tenant_id" = "object_id" WHERE "object_type" = 'tenant';--> statement-breakpoint
UPDATE "object_changes" SET "tenant_id" = (COALESCE("postchange_data", "prechange_data")->>'tenant_id')::integer WHERE "object_type" IN ('site_group', 'site', 'location', 'rack', 'device');--> statement-breakpoint
UPDATE "object_changes" oc SET "tenant_id" = r."tenant_id" FROM "racks" r WHERE oc."object_type" = 'shelf' AND r."id" = (COALESCE(oc."postchange_data", oc."prechange_data")->>'rack_id')::integer;--> statement-breakpoint
UPDATE "object_changes" oc SET "tenant_id" = d."tenant_id" FROM "devices" d WHERE oc."object_type" = 'interface' AND d."id" = (COALESCE(oc."postchange_data", oc."prechange_data")->>'device_id')::integer;--> statement-breakpoint
UPDATE "object_changes" oc SET "tenant_id" = da."tenant_id" FROM "interfaces" ia, "interfaces" ib, "devices" da, "devices" db WHERE oc."object_type" = 'cable' AND ia."id" = (COALESCE(oc."postchange_data", oc."prechange_data")->>'a_interface_id')::integer AND ib."id" = (COALESCE(oc."postchange_data", oc."prechange_data")->>'b_interface_id')::integer AND da."id" = ia."device_id" AND db."id" = ib."device_id" AND da."tenant_id" = db."tenant_id";
