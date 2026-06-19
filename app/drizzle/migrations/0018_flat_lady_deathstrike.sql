CREATE TABLE `OverworldAiPlacement` (
	`id` varchar(191) NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`aiTemplateUserId` varchar(191) NOT NULL,
	`interactionType` enum('FRIENDLY','HOSTILE') NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`sectorType` enum('specific','random','from_list') NOT NULL DEFAULT 'specific',
	`locationType` enum('specific','random') NOT NULL DEFAULT 'specific',
	`sectorList` json NOT NULL,
	`sector` smallint unsigned NOT NULL DEFAULT 0,
	`longitude` tinyint NOT NULL DEFAULT 0,
	`latitude` tinyint NOT NULL DEFAULT 0,
	`questGiveChance` smallint unsigned NOT NULL DEFAULT 0,
	`positionVersion` int NOT NULL DEFAULT 0,
	CONSTRAINT `OverworldAiPlacement_id` PRIMARY KEY(`id`)
);

CREATE TABLE `OverworldAiPlacementQuest` (
	`id` varchar(191) NOT NULL,
	`placementId` varchar(191) NOT NULL,
	`questId` varchar(191) NOT NULL,
	CONSTRAINT `OverworldAiPlacementQuest_id` PRIMARY KEY(`id`),
	CONSTRAINT `OverworldAiPlacementQuest_placement_quest_key` UNIQUE(`placementId`,`questId`)
);

CREATE INDEX `OverworldAiPlacement_sector_idx` ON `OverworldAiPlacement` (`sector`);
CREATE INDEX `OverworldAiPlacement_aiTemplateUserId_idx` ON `OverworldAiPlacement` (`aiTemplateUserId`);
CREATE INDEX `OverworldAiPlacement_isActive_sector_idx` ON `OverworldAiPlacement` (`isActive`,`sector`);
CREATE INDEX `OverworldAiPlacementQuest_placementId_idx` ON `OverworldAiPlacementQuest` (`placementId`);