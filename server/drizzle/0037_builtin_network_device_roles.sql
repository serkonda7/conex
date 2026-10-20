-- Built-in network roles: adopt an existing role of the same name, else
-- create it. Their icons default to the matching glyph.
UPDATE "device_roles" SET "key" = 'ap' WHERE "id" = (SELECT min("id") FROM "device_roles" WHERE lower(trim("name")) = 'ap');--> statement-breakpoint
UPDATE "device_roles" SET "key" = 'firewall' WHERE "id" = (SELECT min("id") FROM "device_roles" WHERE lower(trim("name")) = 'firewall');--> statement-breakpoint
UPDATE "device_roles" SET "key" = 'cloud-key' WHERE "id" = (SELECT min("id") FROM "device_roles" WHERE lower(trim("name")) = 'cloud key');--> statement-breakpoint
UPDATE "device_roles" SET "key" = 'switch' WHERE "id" = (SELECT min("id") FROM "device_roles" WHERE lower(trim("name")) = 'switch');--> statement-breakpoint
INSERT INTO "device_roles" ("name", "key") SELECT 'AP', 'ap' WHERE NOT EXISTS (SELECT 1 FROM "device_roles" WHERE "key" = 'ap');--> statement-breakpoint
INSERT INTO "device_roles" ("name", "key") SELECT 'Firewall', 'firewall' WHERE NOT EXISTS (SELECT 1 FROM "device_roles" WHERE "key" = 'firewall');--> statement-breakpoint
INSERT INTO "device_roles" ("name", "key") SELECT 'Cloud Key', 'cloud-key' WHERE NOT EXISTS (SELECT 1 FROM "device_roles" WHERE "key" = 'cloud-key');--> statement-breakpoint
INSERT INTO "device_roles" ("name", "key") SELECT 'Switch', 'switch' WHERE NOT EXISTS (SELECT 1 FROM "device_roles" WHERE "key" = 'switch');--> statement-breakpoint
UPDATE "device_roles" SET "icon" = 'access-point' WHERE "key" = 'ap' AND "icon" IS NULL;--> statement-breakpoint
UPDATE "device_roles" SET "icon" = 'firewall' WHERE "key" = 'firewall' AND "icon" IS NULL;--> statement-breakpoint
UPDATE "device_roles" SET "icon" = 'cloud' WHERE "key" = 'cloud-key' AND "icon" IS NULL;--> statement-breakpoint
UPDATE "device_roles" SET "icon" = 'switch' WHERE "key" = 'switch' AND "icon" IS NULL;
