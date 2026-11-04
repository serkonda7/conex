ALTER TABLE "users" ADD COLUMN "employee_id" integer;--> statement-breakpoint
-- Scoped accounts now need an employee: give each existing one a contact
-- person in its tenant (named after the username, to be merged by an admin).
WITH "scoped" AS (
	SELECT "username", "tenant_id" FROM "users" WHERE "tenant_id" IS NOT NULL
), "created" AS (
	INSERT INTO "employees" ("last_name", "comments")
	SELECT "username", 'Created for user account ' || "username" FROM "scoped"
	RETURNING "id", "last_name"
), "memberships" AS (
	INSERT INTO "employee_tenants" ("employee_id", "tenant_id", "position")
	SELECT "created"."id", "scoped"."tenant_id", 0
	FROM "created" JOIN "scoped" ON "scoped"."username" = "created"."last_name"
)
UPDATE "users" SET "employee_id" = "created"."id"
FROM "created" WHERE "users"."username" = "created"."last_name";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_tenant_fk" FOREIGN KEY ("employee_id","tenant_id") REFERENCES "public"."employee_tenants"("employee_id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_unique" UNIQUE("employee_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_scope_requires_employee" CHECK ("users"."tenant_id" IS NULL OR "users"."employee_id" IS NOT NULL);