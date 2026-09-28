ALTER TABLE `users` ADD `role` text DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `tenant_id` integer REFERENCES tenants(id);--> statement-breakpoint
-- Pre-roles installs treated every user as full-access: preserve that by
-- backfilling existing rows to `admin`. Runs once, before any role-aware
-- code can insert users, so no new viewer/editor row is affected.
UPDATE `users` SET `role` = 'admin';