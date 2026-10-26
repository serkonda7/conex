-- Built-in peripheral roles: adopt an existing role of the same name, else
-- create it. Roles without an icon get the matching glyph.
UPDATE "device_roles" SET "key" = 'printer' WHERE "id" = (SELECT min("id") FROM "device_roles" WHERE (lower(trim("name")) = 'printer' OR lower(trim("name")) = 'drucker') AND "key" IS NULL) AND NOT EXISTS (SELECT 1 FROM "device_roles" WHERE "key" = 'printer');--> statement-breakpoint
INSERT INTO "device_roles" ("name", "key") SELECT 'Printer', 'printer' WHERE NOT EXISTS (SELECT 1 FROM "device_roles" WHERE "key" = 'printer') AND NOT EXISTS (SELECT 1 FROM "device_roles" WHERE "name" = 'Printer');--> statement-breakpoint
UPDATE "device_roles" SET "icon" = 'printer' WHERE "key" = 'printer' AND "icon" IS NULL;--> statement-breakpoint
UPDATE "device_roles" SET "key" = 'modem' WHERE "id" = (SELECT min("id") FROM "device_roles" WHERE (lower(trim("name")) = 'modem') AND "key" IS NULL) AND NOT EXISTS (SELECT 1 FROM "device_roles" WHERE "key" = 'modem');--> statement-breakpoint
INSERT INTO "device_roles" ("name", "key") SELECT 'Modem', 'modem' WHERE NOT EXISTS (SELECT 1 FROM "device_roles" WHERE "key" = 'modem') AND NOT EXISTS (SELECT 1 FROM "device_roles" WHERE "name" = 'Modem');--> statement-breakpoint
UPDATE "device_roles" SET "icon" = 'router' WHERE "key" = 'modem' AND "icon" IS NULL;--> statement-breakpoint
UPDATE "device_roles" SET "key" = 'telephony' WHERE "id" = (SELECT min("id") FROM "device_roles" WHERE (lower(trim("name")) = 'telephony' OR lower(trim("name")) = 'telephone' OR lower(trim("name")) = 'telefonie') AND "key" IS NULL) AND NOT EXISTS (SELECT 1 FROM "device_roles" WHERE "key" = 'telephony');--> statement-breakpoint
INSERT INTO "device_roles" ("name", "key") SELECT 'Telephony', 'telephony' WHERE NOT EXISTS (SELECT 1 FROM "device_roles" WHERE "key" = 'telephony') AND NOT EXISTS (SELECT 1 FROM "device_roles" WHERE "name" = 'Telephony');--> statement-breakpoint
UPDATE "device_roles" SET "icon" = 'phone' WHERE "key" = 'telephony' AND "icon" IS NULL;--> statement-breakpoint
UPDATE "device_roles" SET "key" = 'ups' WHERE "id" = (SELECT min("id") FROM "device_roles" WHERE (lower(trim("name")) = 'ups' OR lower(trim("name")) = 'usv') AND "key" IS NULL) AND NOT EXISTS (SELECT 1 FROM "device_roles" WHERE "key" = 'ups');--> statement-breakpoint
INSERT INTO "device_roles" ("name", "key") SELECT 'UPS', 'ups' WHERE NOT EXISTS (SELECT 1 FROM "device_roles" WHERE "key" = 'ups') AND NOT EXISTS (SELECT 1 FROM "device_roles" WHERE "name" = 'UPS');--> statement-breakpoint
UPDATE "device_roles" SET "icon" = 'ups' WHERE "key" = 'ups' AND "icon" IS NULL;
