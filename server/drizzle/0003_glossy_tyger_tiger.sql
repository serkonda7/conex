CREATE TABLE `device_type_interfaces` (
	`id` text PRIMARY KEY NOT NULL,
	`device_type_id` text NOT NULL,
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
	`id` text PRIMARY KEY NOT NULL,
	`manufacturer_id` text NOT NULL,
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
CREATE TABLE `manufacturers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manufacturers_name_unique` ON `manufacturers` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `manufacturers_slug_unique` ON `manufacturers` (`slug`);--> statement-breakpoint
CREATE INDEX `manufacturers_name_idx` ON `manufacturers` (`name`);