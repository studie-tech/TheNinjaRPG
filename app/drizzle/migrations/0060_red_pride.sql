CREATE TABLE `UserCraftingQueue` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`itemId` varchar(191) NOT NULL,
	`quantity` int unsigned NOT NULL,
	`materials` json NOT NULL,
	`durationSeconds` int unsigned NOT NULL,
	`startsAt` datetime(3) NOT NULL,
	`finishesAt` datetime(3) NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `UserCraftingQueue_id` PRIMARY KEY(`id`)
);

CREATE TABLE `UserJutsuTrainingQueue` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`jutsuId` varchar(191) NOT NULL,
	`reservedRyo` int unsigned NOT NULL,
	`durationSeconds` int unsigned NOT NULL,
	`startsAt` datetime(3) NOT NULL,
	`finishesAt` datetime(3) NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `UserJutsuTrainingQueue_id` PRIMARY KEY(`id`)
);

ALTER TABLE `UserData` ADD `masteryTrainingQueue` json;
CREATE INDEX `UserCraftingQueue_userId_startsAt_idx` ON `UserCraftingQueue` (`userId`,`startsAt`);
CREATE INDEX `UserCraftingQueue_startsAt_idx` ON `UserCraftingQueue` (`startsAt`);
CREATE INDEX `UserJutsuTrainingQueue_userId_startsAt_idx` ON `UserJutsuTrainingQueue` (`userId`,`startsAt`);
CREATE INDEX `UserJutsuTrainingQueue_startsAt_idx` ON `UserJutsuTrainingQueue` (`startsAt`);
CREATE INDEX `UserJutsuTrainingQueue_jutsuId_idx` ON `UserJutsuTrainingQueue` (`jutsuId`);