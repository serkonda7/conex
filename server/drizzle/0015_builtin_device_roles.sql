ALTER TABLE "device_roles" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "device_roles" ADD CONSTRAINT "device_roles_key_unique" UNIQUE("key");--> statement-breakpoint
-- Built-in roles: adopt an existing role of the same name, else create it.
UPDATE "device_roles" SET "key" = 'pc' WHERE "id" = (SELECT min("id") FROM "device_roles" WHERE lower(trim("name")) = 'pc');--> statement-breakpoint
UPDATE "device_roles" SET "key" = 'server' WHERE "id" = (SELECT min("id") FROM "device_roles" WHERE lower(trim("name")) = 'server');--> statement-breakpoint
INSERT INTO "device_roles" ("name", "key") SELECT 'PC', 'pc' WHERE NOT EXISTS (SELECT 1 FROM "device_roles" WHERE "key" = 'pc');--> statement-breakpoint
INSERT INTO "device_roles" ("name", "key") SELECT 'Server', 'server' WHERE NOT EXISTS (SELECT 1 FROM "device_roles" WHERE "key" = 'server');
