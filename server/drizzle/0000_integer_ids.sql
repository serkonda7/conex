CREATE TABLE `auth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`verifier` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_states_expires_at_idx` ON `auth_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `cables` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`a_interface_id` integer NOT NULL,
	`b_interface_id` integer NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`kind` text,
	`label` text,
	`description` text,
	FOREIGN KEY (`a_interface_id`) REFERENCES `interfaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`b_interface_id`) REFERENCES `interfaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cables_a_interface_id_unique` ON `cables` (`a_interface_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cables_b_interface_id_unique` ON `cables` (`b_interface_id`);--> statement-breakpoint
CREATE INDEX `cables_a_interface_id_idx` ON `cables` (`a_interface_id`);--> statement-breakpoint
CREATE INDEX `cables_b_interface_id_idx` ON `cables` (`b_interface_id`);--> statement-breakpoint
CREATE INDEX `cables_status_idx` ON `cables` (`status`);--> statement-breakpoint
CREATE TABLE `device_type_interfaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_type_id` integer NOT NULL,
	`prefix` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`kind` text DEFAULT 'ethernet' NOT NULL,
	`label` text,
	FOREIGN KEY (`device_type_id`) REFERENCES `device_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `device_type_interfaces_type_id_idx` ON `device_type_interfaces` (`device_type_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_type_interfaces_prefix_kind_idx` ON `device_type_interfaces` (`device_type_id`,`prefix`,`kind`);--> statement-breakpoint
CREATE TABLE `device_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`manufacturer_id` integer NOT NULL,
	`model` text NOT NULL,
	`slug` text NOT NULL,
	`u_height` integer DEFAULT 1 NOT NULL,
	`description` text,
	FOREIGN KEY (`manufacturer_id`) REFERENCES `manufacturers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_types_slug_unique` ON `device_types` (`slug`);--> statement-breakpoint
CREATE INDEX `device_types_manufacturer_id_idx` ON `device_types` (`manufacturer_id`);--> statement-breakpoint
CREATE INDEX `device_types_model_idx` ON `device_types` (`model`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_type_id` integer NOT NULL,
	`site_id` integer,
	`location_id` integer,
	`rack_id` integer,
	`position_u` integer,
	`shelf_id` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`name` text NOT NULL,
	`serial` text,
	`asset_tag` text,
	`tenant_id` integer,
	`description` text,
	FOREIGN KEY (`device_type_id`) REFERENCES `device_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rack_id`) REFERENCES `racks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shelf_id`) REFERENCES `rack_shelves`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_asset_tag_unique` ON `devices` (`asset_tag`);--> statement-breakpoint
CREATE INDEX `devices_type_id_idx` ON `devices` (`device_type_id`);--> statement-breakpoint
CREATE INDEX `devices_site_id_idx` ON `devices` (`site_id`);--> statement-breakpoint
CREATE INDEX `devices_rack_id_idx` ON `devices` (`rack_id`);--> statement-breakpoint
CREATE INDEX `devices_shelf_id_idx` ON `devices` (`shelf_id`);--> statement-breakpoint
CREATE INDEX `devices_tenant_id_idx` ON `devices` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `devices_status_idx` ON `devices` (`status`);--> statement-breakpoint
CREATE INDEX `devices_name_idx` ON `devices` (`name`);--> statement-breakpoint
CREATE TABLE `interfaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'ethernet' NOT NULL,
	`connected` integer DEFAULT 0 NOT NULL,
	`description` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `interfaces_device_id_idx` ON `interfaces` (`device_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `interfaces_device_name_idx` ON `interfaces` (`device_id`,`name`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`parent_id` integer,
	`tenant_id` integer,
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
CREATE TABLE `manufacturers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manufacturers_name_unique` ON `manufacturers` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `manufacturers_slug_unique` ON `manufacturers` (`slug`);--> statement-breakpoint
CREATE INDEX `manufacturers_name_idx` ON `manufacturers` (`name`);--> statement-breakpoint
CREATE TABLE `rack_shelves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rack_id` integer NOT NULL,
	`name` text NOT NULL,
	`position_u` integer NOT NULL,
	`height_u` integer DEFAULT 1 NOT NULL,
	`capacity_slots` integer,
	FOREIGN KEY (`rack_id`) REFERENCES `racks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rack_shelves_rack_id_idx` ON `rack_shelves` (`rack_id`);--> statement-breakpoint
CREATE INDEX `rack_shelves_position_idx` ON `rack_shelves` (`rack_id`,`position_u`);--> statement-breakpoint
CREATE TABLE `racks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`location_id` integer,
	`tenant_id` integer,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`height_u` integer DEFAULT 42 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `racks_slug_unique` ON `racks` (`slug`);--> statement-breakpoint
CREATE INDEX `racks_site_id_idx` ON `racks` (`site_id`);--> statement-breakpoint
CREATE INDEX `racks_location_id_idx` ON `racks` (`location_id`);--> statement-breakpoint
CREATE INDEX `racks_tenant_id_idx` ON `racks` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `racks_name_idx` ON `racks` (`name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` integer,
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
CREATE TABLE `tenants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`comments` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_unique` ON `tenants` (`slug`);--> statement-breakpoint
CREATE INDEX `tenants_name_idx` ON `tenants` (`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`provider` text DEFAULT 'local' NOT NULL,
	`provider_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_provider_id_unique` ON `users` (`provider_id`);