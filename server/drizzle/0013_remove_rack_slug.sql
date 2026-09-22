PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `racks_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL REFERENCES `sites`(`id`),
	`location_id` integer REFERENCES `locations`(`id`),
	`tenant_id` integer REFERENCES `tenants`(`id`),
	`rack_type_id` integer REFERENCES `device_types`(`id`),
	`name` text NOT NULL,
	`description` text,
	`height_u` integer DEFAULT 42 NOT NULL
);
--> statement-breakpoint
INSERT INTO `racks_new` (`id`, `site_id`, `location_id`, `tenant_id`, `rack_type_id`, `name`, `description`, `height_u`)
SELECT `id`, `site_id`, `location_id`, `tenant_id`, `rack_type_id`, `name`, `description`, `height_u`
FROM `racks`;
--> statement-breakpoint
DROP TABLE `racks`;
--> statement-breakpoint
ALTER TABLE `racks_new` RENAME TO `racks`;
--> statement-breakpoint
CREATE INDEX `racks_site_id_idx` ON `racks` (`site_id`);
--> statement-breakpoint
CREATE INDEX `racks_location_id_idx` ON `racks` (`location_id`);
--> statement-breakpoint
CREATE INDEX `racks_tenant_id_idx` ON `racks` (`tenant_id`);
--> statement-breakpoint
CREATE INDEX `racks_name_idx` ON `racks` (`name`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
