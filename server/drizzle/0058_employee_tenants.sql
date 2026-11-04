CREATE TABLE "employee_tenants" (
	"employee_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "employee_tenants_employee_id_tenant_id_pk" PRIMARY KEY("employee_id","tenant_id")
);
--> statement-breakpoint
INSERT INTO "employee_tenants" ("employee_id", "tenant_id", "position") SELECT "id", "tenant_id", 0 FROM "employees";
--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT "devices_employee_tenant_fk";
--> statement-breakpoint
ALTER TABLE "employees" DROP CONSTRAINT "employees_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "virtual_machines" DROP CONSTRAINT "virtual_machines_employee_tenant_fk";
--> statement-breakpoint
DROP INDEX "employees_tenant_id_idx";--> statement-breakpoint
DROP INDEX "employees_id_tenant_id_idx";--> statement-breakpoint
ALTER TABLE "employee_tenants" ADD CONSTRAINT "employee_tenants_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_tenants" ADD CONSTRAINT "employee_tenants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_tenants_tenant_id_idx" ON "employee_tenants" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_employee_tenant_fk" FOREIGN KEY ("employee_id","tenant_id") REFERENCES "public"."employee_tenants"("employee_id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_machines" ADD CONSTRAINT "virtual_machines_employee_tenant_fk" FOREIGN KEY ("employee_id","tenant_id") REFERENCES "public"."employee_tenants"("employee_id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "tenant_id";