ALTER TABLE `site_groups` ADD `tenant_id` integer REFERENCES tenants(id);--> statement-breakpoint
CREATE INDEX `site_groups_tenant_id_idx` ON `site_groups` (`tenant_id`);