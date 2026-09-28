CREATE TABLE `site_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_id` integer,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`comments` text,
	FOREIGN KEY (`parent_id`) REFERENCES `site_groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `site_groups_parent_id_idx` ON `site_groups` (`parent_id`);--> statement-breakpoint
CREATE INDEX `site_groups_name_idx` ON `site_groups` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `site_groups_sibling_slug_idx` ON `site_groups` (`parent_id`,`slug`);--> statement-breakpoint
ALTER TABLE `sites` ADD `site_group_id` integer REFERENCES site_groups(id);--> statement-breakpoint
CREATE INDEX `sites_site_group_id_idx` ON `sites` (`site_group_id`);--> statement-breakpoint
ALTER TABLE `sites` DROP COLUMN `group`;