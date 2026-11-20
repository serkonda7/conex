-- IF NOT EXISTS: databases created from the briefly edited 0000_init already have these.
CREATE TABLE IF NOT EXISTS "m365_tenants" (
	"ms_tenant_id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"default_domain" text,
	"consented_at" bigint NOT NULL,
	"last_ok_at" bigint,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "integrations" ALTER COLUMN "base_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ALTER COLUMN "username" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;
