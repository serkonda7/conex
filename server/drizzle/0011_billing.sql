CREATE TABLE "billing_counts" (
	"period" text NOT NULL,
	"tenant_id" integer NOT NULL,
	"tenant_name" text NOT NULL,
	"customer_number" text,
	"bundle_id" integer NOT NULL,
	"bundle_name" text NOT NULL,
	"service_level_name" text NOT NULL,
	"metric" text NOT NULL,
	"quantity" integer NOT NULL,
	"lots" integer NOT NULL,
	"carried" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "billing_counts_period_tenant_id_bundle_id_metric_pk" PRIMARY KEY("period","tenant_id","bundle_id","metric")
);
--> statement-breakpoint
CREATE TABLE "billing_inputs" (
	"period" text NOT NULL,
	"tenant_id" integer NOT NULL,
	"bundle_id" integer NOT NULL,
	"metric" text NOT NULL,
	"quantity" integer NOT NULL,
	"updated_at" bigint NOT NULL,
	"updated_by" text,
	CONSTRAINT "billing_inputs_tenant_id_bundle_id_metric_period_pk" PRIMARY KEY("tenant_id","bundle_id","metric","period")
);
--> statement-breakpoint
CREATE TABLE "billing_items" (
	"period" text NOT NULL,
	"tenant_id" integer NOT NULL,
	"bundle_id" integer NOT NULL,
	"metric" text NOT NULL,
	"item_type" text NOT NULL,
	"item_id" text NOT NULL,
	"ref_id" integer,
	"item_repr" text NOT NULL,
	"detail" text,
	CONSTRAINT "billing_items_period_tenant_id_bundle_id_metric_item_type_item_id_pk" PRIMARY KEY("period","tenant_id","bundle_id","metric","item_type","item_id")
);
--> statement-breakpoint
CREATE TABLE "billing_periods" (
	"period" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"cutoff_at" bigint NOT NULL,
	"taken_at" bigint NOT NULL,
	"taken_by" text,
	"finalized_at" bigint,
	"finalized_by" text,
	"bundles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exceptions" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "backed_up" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "global_settings" ADD COLUMN "billing_cutoff_day" integer;--> statement-breakpoint
ALTER TABLE "managed_bundles" ADD COLUMN "billing_metrics" jsonb DEFAULT '[{"metric":"objects"}]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "virtual_machines" ADD COLUMN "backed_up" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_counts" ADD CONSTRAINT "billing_counts_period_billing_periods_period_fk" FOREIGN KEY ("period") REFERENCES "public"."billing_periods"("period") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_inputs" ADD CONSTRAINT "billing_inputs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_inputs" ADD CONSTRAINT "billing_inputs_bundle_id_managed_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."managed_bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_items" ADD CONSTRAINT "billing_items_period_billing_periods_period_fk" FOREIGN KEY ("period") REFERENCES "public"."billing_periods"("period") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- New permission `billing.manage`: granted to every role that manages users,
-- so the admin role keeps holding the full catalog (`fullAccessRoleId`).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "role_id", 'billing.manage' FROM "role_permissions" WHERE "permission" = 'users.manage'
ON CONFLICT DO NOTHING;
