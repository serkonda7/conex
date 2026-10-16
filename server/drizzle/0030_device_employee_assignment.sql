ALTER TABLE "devices" ADD COLUMN "employee_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "employees_id_tenant_id_idx" ON "employees" USING btree ("id","tenant_id");--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_employee_tenant_fk" FOREIGN KEY ("employee_id","tenant_id") REFERENCES "public"."employees"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_employee_id_idx" ON "devices" USING btree ("employee_id");--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_employee_requires_tenant" CHECK ("devices"."employee_id" IS NULL OR "devices"."tenant_id" IS NOT NULL);
