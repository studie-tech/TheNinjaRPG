CREATE TABLE `TerritoryWar` (
	`id` varchar(191) NOT NULL,
	`predecessorId` varchar(191) NOT NULL,
	`sector` smallint NOT NULL,
	`guardianId` varchar(191) NOT NULL,
	`startsAt` datetime(3) NOT NULL,
	`endsAt` datetime(3) NOT NULL,
	`resolvedAt` datetime(3),
	`version` int NOT NULL DEFAULT 0,
	CONSTRAINT `TerritoryWar_id` PRIMARY KEY(`id`),
	CONSTRAINT `TerritoryWar_predecessor_key` UNIQUE(`predecessorId`)
);

CREATE TABLE `TerritoryWarReceipt` (
	`battleId` varchar(191) NOT NULL,
	`warId` varchar(191) NOT NULL,
	CONSTRAINT `TerritoryWarReceipt_battleId` PRIMARY KEY(`battleId`)
);

CREATE TABLE `TerritoryWarScore` (
	`warId` varchar(191) NOT NULL,
	`competitorId` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL,
	`clanId` varchar(191),
	`villageId` varchar(191),
	`points` int NOT NULL DEFAULT 0,
	`rewarded` boolean NOT NULL DEFAULT false,
	CONSTRAINT `TerritoryWarScore_warId_competitorId_pk` PRIMARY KEY(`warId`,`competitorId`)
);

ALTER TABLE `Battle` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TERRITORY_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD','HUNTING') NOT NULL;
ALTER TABLE `BattleHistory` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TERRITORY_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD','HUNTING');
ALTER TABLE `DataBattleAction` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TERRITORY_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD','HUNTING') NOT NULL;
ALTER TABLE `LogTimeDurations` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TERRITORY_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD','HUNTING') NOT NULL;
ALTER TABLE `LogRankedPicks` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TERRITORY_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD','HUNTING') NOT NULL;
ALTER TABLE `MpvpBattleQueue` MODIFY COLUMN `battleType` enum('TERRITORY_WAR','CLAN_BATTLE','SHRINE_BATTLE','RAID_BATTLE') NOT NULL DEFAULT 'CLAN_BATTLE';
ALTER TABLE `Clan` ADD `territoryWarBoostUntil` datetime(3);
ALTER TABLE `MpvpBattleQueue` ADD `territoryWarId` varchar(191);
ALTER TABLE `UserJutsu` ADD `trainingStartedAt` datetime(3);
ALTER TABLE `Village` ADD `territoryWarBoostUntil` datetime(3);
CREATE INDEX `TerritoryWar_startsAt_idx` ON `TerritoryWar` (`startsAt`);
CREATE INDEX `TerritoryWarReceipt_warId_idx` ON `TerritoryWarReceipt` (`warId`);
CREATE INDEX `TerritoryWarScore_competitor_rewarded_idx` ON `TerritoryWarScore` (`competitorId`,`rewarded`);
CREATE INDEX `MpvpBattleQueue_territoryWar_idx` ON `MpvpBattleQueue` (`territoryWarId`);