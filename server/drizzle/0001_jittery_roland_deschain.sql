CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`parent_id` text,
	`tenant_id` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `locations_site_id_idx` ON `locations` (`site_id`);--> statement-breakpoint
CREATE INDEX `locations_parent_id_idx` ON `locations` (`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `locations_sibling_slug_idx` ON `locations` (`site_id`,`parent_id`,`slug`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`group` text,
	`description` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sites_slug_unique` ON `sites` (`slug`);--> statement-breakpoint
CREATE INDEX `sites_tenant_id_idx` ON `sites` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `sites_name_idx` ON `sites` (`name`);--> statement-breakpoint
CREATE TABLE `tenant_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_groups_slug_unique` ON `tenant_groups` (`slug`);--> statement-breakpoint
CREATE INDEX `tenant_groups_name_idx` ON `tenant_groups` (`name`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	FOREIGN KEY (`group_id`) REFERENCES `tenant_groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_unique` ON `tenants` (`slug`);--> statement-breakpoint
CREATE INDEX `tenants_group_id_idx` ON `tenants` (`group_id`);--> statement-breakpoint
CREATE INDEX `tenants_name_idx` ON `tenants` (`name`);