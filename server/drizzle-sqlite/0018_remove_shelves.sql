PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
UPDATE `device_types` SET `u_height` = 1 WHERE `u_height` < 1;--> statement-breakpoint
CREATE TABLE `__new_devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_type_id` integer NOT NULL,
	`site_id` integer,
	`location_id` integer,
	`rack_id` integer,
	`face` text,
	`position_u` integer,
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
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_devices`("id", "device_type_id", "site_id", "location_id", "rack_id", "face", "position_u", "status", "name", "serial", "asset_tag", "tenant_id", "description") SELECT "id", "device_type_id", "site_id", "location_id", "rack_id", "face", "position_u", "status", "name", "serial", "asset_tag", "tenant_id", "description" FROM `devices`;--> statement-breakpoint
DROP TABLE `devices`;--> statement-breakpoint
ALTER TABLE `__new_devices` RENAME TO `devices`;--> statement-breakpoint
DROP TABLE `rack_shelves`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;--> statement-breakpoint
CREATE UNIQUE INDEX `devices_asset_tag_unique` ON `devices` (`asset_tag`);--> statement-breakpoint
CREATE INDEX `devices_type_id_idx` ON `devices` (`device_type_id`);--> statement-breakpoint
CREATE INDEX `devices_site_id_idx` ON `devices` (`site_id`);--> statement-breakpoint
CREATE INDEX `devices_rack_id_idx` ON `devices` (`rack_id`);--> statement-breakpoint
CREATE INDEX `devices_tenant_id_idx` ON `devices` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `devices_status_idx` ON `devices` (`status`);--> statement-breakpoint
CREATE INDEX `devices_name_idx` ON `devices` (`name`);
