CREATE TABLE `FarmCollectionLog` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`itemId` varchar(191) NOT NULL,
	`firstHarvestedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `FarmCollectionLog_id` PRIMARY KEY(`id`),
	CONSTRAINT `FarmCollectionLog_userId_itemId_key` UNIQUE(`userId`,`itemId`)
);

CREATE TABLE `FarmExtraction` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`extractorSlot` smallint unsigned NOT NULL,
	`cropItemId` varchar(191) NOT NULL,
	`seedItemId` varchar(191) NOT NULL,
	`cropQuantity` int NOT NULL,
	`seedQuantity` int NOT NULL,
	`startedAt` datetime(3) NOT NULL,
	`finishAt` datetime(3) NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `FarmExtraction_id` PRIMARY KEY(`id`),
	CONSTRAINT `FarmExtraction_userId_extractorSlot_key` UNIQUE(`userId`,`extractorSlot`)
);

CREATE TABLE `FarmPlot` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`slotIndex` smallint unsigned NOT NULL,
	`seedItemId` varchar(191),
	`plantedAt` datetime(3),
	`finishAt` datetime(3),
	`lastWateredAt` datetime(3),
	`fertilizerApplied` boolean NOT NULL DEFAULT false,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `FarmPlot_id` PRIMARY KEY(`id`),
	CONSTRAINT `FarmPlot_userId_slotIndex_key` UNIQUE(`userId`,`slotIndex`)
);

ALTER TABLE `Item` ADD `isFarmSeed` boolean DEFAULT false NOT NULL;
ALTER TABLE `Item` ADD `farmGrowTimeSeconds` int DEFAULT 0 NOT NULL;
ALTER TABLE `Item` ADD `farmYieldItemId` varchar(191);
ALTER TABLE `Item` ADD `farmMinLevel` int DEFAULT 1 NOT NULL;
ALTER TABLE `Item` ADD `farmPlantExperience` int DEFAULT 0 NOT NULL;
ALTER TABLE `Item` ADD `farmHarvestExperience` int DEFAULT 0 NOT NULL;
ALTER TABLE `Item` ADD `farmSellValue` int DEFAULT 0 NOT NULL;
ALTER TABLE `Item` ADD `farmExtractSeedItemId` varchar(191);
ALTER TABLE `Item` ADD `farmExtractSeedCount` int DEFAULT 0 NOT NULL;
ALTER TABLE `Item` ADD `isFarmFertilizer` boolean DEFAULT false NOT NULL;
ALTER TABLE `Item` ADD `farmTimeReductionSeconds` int DEFAULT 0 NOT NULL;
ALTER TABLE `Item` ADD `farmFertilizerExperience` int DEFAULT 0 NOT NULL;
ALTER TABLE `Quest` ADD `requiredFarmingLevel` int DEFAULT 0 NOT NULL;
ALTER TABLE `UserData` ADD `farmingExperience` int DEFAULT 0 NOT NULL;
ALTER TABLE `UserData` ADD `farmCurrency` int DEFAULT 0 NOT NULL;
ALTER TABLE `UserData` ADD `farmPlotsPurchased` smallint unsigned DEFAULT 0 NOT NULL;
ALTER TABLE `UserData` ADD `farmExtractorsOwned` smallint unsigned DEFAULT 0 NOT NULL;
CREATE INDEX `FarmCollectionLog_userId_idx` ON `FarmCollectionLog` (`userId`);
CREATE INDEX `FarmCollectionLog_itemId_idx` ON `FarmCollectionLog` (`itemId`);
CREATE INDEX `FarmExtraction_userId_idx` ON `FarmExtraction` (`userId`);
CREATE INDEX `FarmExtraction_userId_finishAt_idx` ON `FarmExtraction` (`userId`,`finishAt`);
CREATE INDEX `FarmPlot_userId_idx` ON `FarmPlot` (`userId`);
CREATE INDEX `Quest_requiredFarmingLevel_idx` ON `Quest` (`requiredFarmingLevel`);