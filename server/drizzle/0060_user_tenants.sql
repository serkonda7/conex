CREATE TABLE "user_tenants" (
	"user_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	CONSTRAINT "user_tenants_user_id_tenant_id_pk" PRIMARY KEY("user_id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_scope_requires_employee";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_employee_tenant_fk";
--> statement-breakpoint
ALTER TABLE "user_tenants" ADD CONSTRAINT "user_tenants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tenants" ADD CONSTRAINT "user_tenants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_tenants_tenant_id_idx" ON "user_tenants" USING btree ("tenant_id");--> statement-breakpoint
-- Employee-linked accounts are now scoped to exactly their employee's
-- tenants, and user managers must stay global: unlink their employees.
UPDATE "users" SET "employee_id" = NULL
WHERE "employee_id" IS NOT NULL
	AND "role_id" IN (SELECT "role_id" FROM "role_permissions" WHERE "permission" = 'users.manage');--> statement-breakpoint
-- Changing employee tenants changes account scopes: keep it with user managers.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "role_id", 'employees.tenants' FROM "role_permissions" WHERE "permission" = 'users.manage'
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "tenant_id";