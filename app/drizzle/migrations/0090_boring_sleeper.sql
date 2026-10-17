CREATE TABLE `HuntingHabitat` (
	`id` varchar(191) NOT NULL,
	`content` json NOT NULL,
	`updatedAt` datetime(3) NOT NULL,
	CONSTRAINT `HuntingHabitat_id` PRIMARY KEY(`id`)
);

CREATE TABLE `HuntingProgress` (
	`userId` varchar(191) NOT NULL,
	`contractId` varchar(191) NOT NULL,
	`used` int NOT NULL DEFAULT 0,
	`cooldownUntil` datetime(3),
	`version` int NOT NULL DEFAULT 0,
	CONSTRAINT `HuntingProgress_userId_contractId_pk` PRIMARY KEY(`userId`,`contractId`)
);

CREATE TABLE `HuntingReceipt` (
	`battleId` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`contractId` varchar(191) NOT NULL,
	`result` json NOT NULL,
	`createdAt` datetime(3) NOT NULL,
	CONSTRAINT `HuntingReceipt_battleId` PRIMARY KEY(`battleId`)
);

CREATE TABLE `HuntingSession` (
	`userId` varchar(191) NOT NULL,
	`id` varchar(191) NOT NULL,
	`habitatId` varchar(191) NOT NULL,
	`contractId` varchar(191) NOT NULL,
	`sector` smallint NOT NULL,
	`readyAt` datetime(3),
	`battleId` varchar(191),
	`version` int NOT NULL DEFAULT 0,
	`startedAt` datetime(3) NOT NULL,
	`lastResult` json,
	CONSTRAINT `HuntingSession_userId` PRIMARY KEY(`userId`)
);

ALTER TABLE `Battle` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD','HUNTING') NOT NULL;
ALTER TABLE `BattleHistory` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD','HUNTING');
ALTER TABLE `DataBattleAction` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD','HUNTING') NOT NULL;
ALTER TABLE `LogTimeDurations` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD','HUNTING') NOT NULL;
ALTER TABLE `LogRankedPicks` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD','HUNTING') NOT NULL;
CREATE INDEX `HuntingProgress_contract_idx` ON `HuntingProgress` (`contractId`);
CREATE INDEX `HuntingReceipt_user_idx` ON `HuntingReceipt` (`userId`);
CREATE INDEX `HuntingSession_habitat_idx` ON `HuntingSession` (`habitatId`);