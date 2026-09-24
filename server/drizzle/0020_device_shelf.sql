ALTER TABLE `devices` ADD `shelf_id` integer REFERENCES shelves(id);--> statement-breakpoint
CREATE INDEX `devices_shelf_id_idx` ON `devices` (`shelf_id`);