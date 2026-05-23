ALTER TABLE `users` DROP INDEX `users_openId_unique`;--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `isActive` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `createdByAdminId` int;--> statement-breakpoint
UPDATE `users`
SET `email` = CONCAT('legacy-user-', `id`, '@local.invalid')
WHERE `email` IS NULL OR `email` = '';--> statement-breakpoint
UPDATE `users`
SET `passwordHash` = '$2b$12$0lRYVPraR1/AFpNi/rtv9ODTx1HUT//wijSzr8bHtweddLm7MkJfq'
WHERE `passwordHash` IS NULL OR `passwordHash` = '';--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `email` varchar(320) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `passwordHash` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_email_unique` UNIQUE(`email`);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_createdByAdminId_users_id_fk` FOREIGN KEY (`createdByAdminId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `openId`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `loginMethod`;
