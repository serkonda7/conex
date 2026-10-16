ALTER TABLE "device_roles" ADD COLUMN "parent_id" integer;--> statement-breakpoint
ALTER TABLE "device_roles" ADD CONSTRAINT "device_roles_parent_id_device_roles_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."device_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_roles_parent_id_idx" ON "device_roles" USING btree ("parent_id");