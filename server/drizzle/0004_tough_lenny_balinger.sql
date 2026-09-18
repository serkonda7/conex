CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`device_type_id` text NOT NULL,
	`site_id` text,
	`location_id` text,
	`rack_id` text,
	`position_u` integer,
	`shelf_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`name` text NOT NULL,
	`serial` text,
	`asset_tag` text,
	`tenant_id` text,
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
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'ethernet' NOT NULL,
	`connected` integer DEFAULT 0 NOT NULL,
	`description` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `interfaces_device_id_idx` ON `interfaces` (`device_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `interfaces_device_name_idx` ON `interfaces` (`device_id`,`name`);