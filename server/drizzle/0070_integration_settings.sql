ALTER TABLE "integrations" ALTER COLUMN "base_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ALTER COLUMN "username" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;