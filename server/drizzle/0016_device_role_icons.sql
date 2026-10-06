ALTER TABLE "device_roles" ADD COLUMN "icon" text;--> statement-breakpoint
UPDATE "device_roles" SET "icon" = 'desktop' WHERE "key" = 'pc' AND "icon" IS NULL;--> statement-breakpoint
UPDATE "device_roles" SET "icon" = 'server' WHERE "key" = 'server' AND "icon" IS NULL;
