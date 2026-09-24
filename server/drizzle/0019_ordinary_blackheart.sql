PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_shelves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rack_id` integer NOT NULL,
	`name` text,
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
INSERT INTO `__new_shelves`("id", "rack_id", "name", "face", "position_u", "mount_height", "mount_usable", "reserved_height", "is_full_depth", "description") SELECT "id", "rack_id", "name", "face", "position_u", "mount_height", "mount_usable", "reserved_height", "is_full_depth", "description" FROM `shelves`;--> statement-breakpoint
DROP TABLE `shelves`;--> statement-breakpoint
ALTER TABLE `__new_shelves` RENAME TO `shelves`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `shelves_rack_id_idx` ON `shelves` (`rack_id`);--> statement-breakpoint
CREATE INDEX `shelves_name_idx` ON `shelves` (`name`);