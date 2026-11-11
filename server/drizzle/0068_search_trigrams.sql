-- Trigram indexes for the `%term%` ILIKE of `searchCondition`. drizzle-kit
-- does not emit extensions, so this line is added by hand. pg_trgm is a
-- trusted extension (Postgres 13+): a role with CREATE on the database (e.g.
-- its owner) may create it, no superuser needed.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX "cables_label_trgm_idx" ON "cables" USING gin ("label" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "cables_kind_trgm_idx" ON "cables" USING gin ("kind" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "devices_name_trgm_idx" ON "devices" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "devices_asset_tag_trgm_idx" ON "devices" USING gin ("asset_tag" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "devices_device_id_trgm_idx" ON "devices" USING gin ("device_id" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "devices_serial_trgm_idx" ON "devices" USING gin ("serial" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "object_changes_object_repr_trgm_idx" ON "object_changes" USING gin ("object_repr" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "object_changes_username_trgm_idx" ON "object_changes" USING gin ("username" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "virtual_machines_name_trgm_idx" ON "virtual_machines" USING gin ("name" gin_trgm_ops);