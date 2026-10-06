ALTER TABLE "tenants" ADD COLUMN "emails" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "phones" jsonb DEFAULT '[]'::jsonb NOT NULL;