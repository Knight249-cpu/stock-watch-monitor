CREATE TABLE `watchlistItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`country` enum('TH','CN','US') NOT NULL,
	`queryText` varchar(128) NOT NULL,
	`symbol` varchar(32) NOT NULL,
	`displayName` varchar(255) NOT NULL,
	`exchangeName` varchar(64),
	`sourceName` varchar(64) NOT NULL,
	`sourceUrl` varchar(512) NOT NULL,
	`currency` varchar(16),
	`currentPrice` decimal(18,4) NOT NULL DEFAULT '0.0000',
	`cutloss` decimal(18,4),
	`sale` decimal(18,4),
	`lastPriceAtMs` bigint,
	`lastSignal` enum('none','cutloss','sale') NOT NULL DEFAULT 'none',
	`lastAlertAtMs` bigint,
	`lastAlertPrice` decimal(18,4),
	`createdAtMs` bigint NOT NULL,
	`updatedAtMs` bigint NOT NULL,
	CONSTRAINT `watchlistItems_id` PRIMARY KEY(`id`),
	CONSTRAINT `watchlist_items_user_symbol_unique_idx` UNIQUE(`userId`,`country`,`symbol`)
);
--> statement-breakpoint
CREATE TABLE `watchlistSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`lineUserId` varchar(255),
	`lineTargetType` enum('user','group','room') NOT NULL DEFAULT 'user',
	`alertsEnabled` int NOT NULL DEFAULT 1,
	`autoRefreshSeconds` int NOT NULL DEFAULT 60,
	`createdAtMs` bigint NOT NULL,
	`updatedAtMs` bigint NOT NULL,
	CONSTRAINT `watchlistSettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `watchlist_settings_user_unique_idx` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `watchlistItems` ADD CONSTRAINT `watchlistItems_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `watchlistSettings` ADD CONSTRAINT `watchlistSettings_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;