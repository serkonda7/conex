CREATE TABLE `cables` (
	`id` text PRIMARY KEY NOT NULL,
	`a_interface_id` text NOT NULL,
	`b_interface_id` text NOT NULL,
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
CREATE INDEX `cables_status_idx` ON `cables` (`status`);