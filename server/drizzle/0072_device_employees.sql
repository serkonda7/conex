CREATE TABLE "device_employees" (
	"device_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	CONSTRAINT "device_employees_device_id_employee_id_pk" PRIMARY KEY("device_id","employee_id")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_id_tenant_id_unique" UNIQUE("id","tenant_id");--> statement-breakpoint
ALTER TABLE "device_employees" ADD CONSTRAINT "device_employees_device_tenant_fk" FOREIGN KEY ("device_id","tenant_id") REFERENCES "public"."devices"("id","tenant_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "device_employees" ADD CONSTRAINT "device_employees_employee_tenant_fk" FOREIGN KEY ("employee_id","tenant_id") REFERENCES "public"."employee_tenants"("employee_id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_employees_employee_id_idx" ON "device_employees" USING btree ("employee_id");--> statement-breakpoint
-- Carry over the single assignments (the old check guaranteed a tenant).
INSERT INTO "device_employees" ("device_id", "employee_id", "tenant_id")
	SELECT "id", "employee_id", "tenant_id" FROM "devices" WHERE "employee_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT "devices_employee_requires_tenant";--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT "devices_employee_tenant_fk";--> statement-breakpoint
DROP INDEX "devices_employee_id_idx";--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "employee_id";
