CREATE TABLE `rack_shelves` (
	`id` text PRIMARY KEY NOT NULL,
	`rack_id` text NOT NULL,
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
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`location_id` text,
	`tenant_id` text,
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
CREATE INDEX `racks_name_idx` ON `racks` (`name`);