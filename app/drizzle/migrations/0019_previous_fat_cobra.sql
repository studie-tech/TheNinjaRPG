CREATE TABLE `UserCraftingQueue` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`itemId` varchar(191) NOT NULL,
	`quantity` int unsigned NOT NULL,
	`durationSeconds` int unsigned NOT NULL,
	`craftingExperience` int unsigned NOT NULL,
	`startsAt` datetime(3) NOT NULL,
	`finishesAt` datetime(3) NOT NULL,
	`completedAt` datetime(3),
	`cancelledAt` datetime(3),
	`outputCreatedAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `UserCraftingQueue_id` PRIMARY KEY(`id`)
);

CREATE TABLE `UserCraftingQueueMaterial` (
	`id` varchar(191) NOT NULL,
	`queueId` varchar(191) NOT NULL,
	`itemId` varchar(191) NOT NULL,
	`quantity` int unsigned NOT NULL,
	`sourceUserItemId` varchar(191) NOT NULL,
	`sourceEquipped` enum('HEAD','CHEST','LEGS','FEET','HAND_1','HAND_2','THROWN','WAIST','KEYSTONE','ITEM_1','ITEM_2','ITEM_3','ITEM_4','ITEM_5','ITEM_6','NONE') NOT NULL DEFAULT 'NONE',
	`sourceDurability` smallint unsigned NOT NULL,
	`sourceStoredAtHome` boolean NOT NULL DEFAULT false,
	`sourceActiveVariantId` varchar(191),
	`sourceDropChancePerc` smallint unsigned NOT NULL DEFAULT 0,
	CONSTRAINT `UserCraftingQueueMaterial_id` PRIMARY KEY(`id`)
);

CREATE TABLE `UserJutsuTrainingQueue` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`jutsuId` varchar(191) NOT NULL,
	`projectedLevel` int unsigned NOT NULL,
	`reservedRyo` int unsigned NOT NULL,
	`durationSeconds` int unsigned NOT NULL,
	`startsAt` datetime(3) NOT NULL,
	`finishesAt` datetime(3) NOT NULL,
	`completedAt` datetime(3),
	`cancelledAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `UserJutsuTrainingQueue_id` PRIMARY KEY(`id`)
);

CREATE TABLE `UserStatTrainingQueue` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`stat` enum('ninjutsuOffence','taijutsuOffence','genjutsuOffence','bukijutsuOffence','ninjutsuDefence','taijutsuDefence','genjutsuDefence','bukijutsuDefence','intelligence','speed','willpower','strength') NOT NULL,
	`trainingSpeed` enum('15min','1hr','4hrs','8hrs','12hrs','24hrs') NOT NULL,
	`durationSeconds` int unsigned NOT NULL,
	`fullStatGain` double NOT NULL,
	`fullExperienceGain` double NOT NULL,
	`startsAt` datetime(3) NOT NULL,
	`finishesAt` datetime(3) NOT NULL,
	`completedAt` datetime(3),
	`cancelledAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `UserStatTrainingQueue_id` PRIMARY KEY(`id`)
);

CREATE INDEX `UserCraftingQueue_userId_finishesAt_idx` ON `UserCraftingQueue` (`userId`,`finishesAt`);
CREATE INDEX `UserCraftingQueue_userId_startsAt_idx` ON `UserCraftingQueue` (`userId`,`startsAt`);
CREATE INDEX `UserCraftingQueue_userId_completedAt_cancelledAt_idx` ON `UserCraftingQueue` (`userId`,`completedAt`,`cancelledAt`);
CREATE INDEX `UserCraftingQueue_due_idx` ON `UserCraftingQueue` (`completedAt`,`cancelledAt`,`finishesAt`);
CREATE INDEX `UserCraftingQueueMaterial_queueId_idx` ON `UserCraftingQueueMaterial` (`queueId`);
CREATE INDEX `UserJutsuTrainingQueue_userId_finishesAt_idx` ON `UserJutsuTrainingQueue` (`userId`,`finishesAt`);
CREATE INDEX `UserJutsuTrainingQueue_userId_startsAt_idx` ON `UserJutsuTrainingQueue` (`userId`,`startsAt`);
CREATE INDEX `UserJutsuTrainingQueue_userId_completedAt_cancelledAt_idx` ON `UserJutsuTrainingQueue` (`userId`,`completedAt`,`cancelledAt`);
CREATE INDEX `UserJutsuTrainingQueue_due_idx` ON `UserJutsuTrainingQueue` (`completedAt`,`cancelledAt`,`finishesAt`);
CREATE INDEX `UserJutsuTrainingQueue_userId_jutsuId_idx` ON `UserJutsuTrainingQueue` (`userId`,`jutsuId`);
CREATE INDEX `UserStatTrainingQueue_userId_finishesAt_idx` ON `UserStatTrainingQueue` (`userId`,`finishesAt`);
CREATE INDEX `UserStatTrainingQueue_userId_startsAt_idx` ON `UserStatTrainingQueue` (`userId`,`startsAt`);
CREATE INDEX `UserStatTrainingQueue_userId_completedAt_cancelledAt_idx` ON `UserStatTrainingQueue` (`userId`,`completedAt`,`cancelledAt`);
CREATE INDEX `UserStatTrainingQueue_due_idx` ON `UserStatTrainingQueue` (`completedAt`,`cancelledAt`,`finishesAt`);