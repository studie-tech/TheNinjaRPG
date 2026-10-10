CREATE TABLE `UserQueue` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`kind` enum('JUTSU','CRAFT','MASTERY','ENERGY') NOT NULL,
	`position` int unsigned NOT NULL,
	`jutsuId` varchar(191),
	`itemId` varchar(191),
	`stat` varchar(64),
	`speed` enum('15min','1hr','4hrs','8hrs','12hrs','24hrs'),
	`energy` double,
	`reservedRyo` int unsigned,
	`quantity` int unsigned,
	`materials` json,
	`durationSeconds` int unsigned,
	`startsAt` datetime(3),
	`finishesAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `UserQueue_id` PRIMARY KEY(`id`),
	CONSTRAINT `UserQueue_userId_kind_position_key` UNIQUE(`userId`,`kind`,`position`)
);

ALTER TABLE `UserData` ADD `energyQueueHead` int unsigned DEFAULT 0 NOT NULL;
ALTER TABLE `UserData` ADD `energyQueueTail` int unsigned DEFAULT 0 NOT NULL;
ALTER TABLE `UserData` ADD `masteryQueueHead` int unsigned DEFAULT 0 NOT NULL;
ALTER TABLE `UserData` DROP COLUMN `energyTrainingQueue`;