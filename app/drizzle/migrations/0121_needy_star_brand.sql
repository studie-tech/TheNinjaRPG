CREATE TABLE `UserDataJob` (
	`id` varchar(191) NOT NULL,
	`kind` enum('NEWS','NOTIFICATION','DAILY_COUNTERS','TAVERN_DECAY') NOT NULL,
	`cursor` varchar(191) NOT NULL DEFAULT '',
	`excludedUserId` varchar(191),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`completedAt` datetime(3),
	CONSTRAINT `UserDataJob_id` PRIMARY KEY(`id`)
);

ALTER TABLE `Notification` ADD `isDeferred` boolean DEFAULT false NOT NULL;
ALTER TABLE `UserData` ADD `unreadNotificationIds` json DEFAULT ('[]') NOT NULL;
ALTER TABLE `UserData` ADD `newsReadIds` json DEFAULT ('[]') NOT NULL;
ALTER TABLE `UserData` ADD `newsVersion` int DEFAULT 0 NOT NULL;
CREATE INDEX `UserDataJob_pending_idx` ON `UserDataJob` (`completedAt`,`createdAt`);