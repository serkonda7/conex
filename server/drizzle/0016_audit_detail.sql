ALTER TABLE "audit_log" ADD COLUMN "detail" jsonb;--> statement-breakpoint
UPDATE "audit_log" SET "detail" = jsonb_build_object('target_username', "target_username") WHERE "target_username" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "target_username";
