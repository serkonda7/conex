ALTER TABLE `users` RENAME COLUMN `email` TO `username`;--> statement-breakpoint
DROP INDEX IF EXISTS `users_email_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);
