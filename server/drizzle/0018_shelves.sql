CREATE TABLE `shelves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rack_id` integer NOT NULL,
	`name` text NOT NULL,
	`face` text,
	`position_u` integer NOT NULL,
	`mount_height` integer DEFAULT 1 NOT NULL,
	`mount_usable` integer DEFAULT 0 NOT NULL,
	`reserved_height` integer DEFAULT 0 NOT NULL,
	`is_full_depth` integer DEFAULT 1 NOT NULL,
	`description` text,
	FOREIGN KEY (`rack_id`) REFERENCES `racks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `shelves_rack_id_idx` ON `shelves` (`rack_id`);--> statement-breakpoint
CREATE INDEX `shelves_name_idx` ON `shelves` (`name`);