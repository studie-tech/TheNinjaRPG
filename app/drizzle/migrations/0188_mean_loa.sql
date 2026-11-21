CREATE TABLE `Caravan` (
	`id` varchar(191) NOT NULL,
	`routeId` varchar(191) NOT NULL,
	`originVillageId` varchar(191) NOT NULL,
	`destinationVillageId` varchar(191) NOT NULL,
	`status` enum('PREPARING','TRAVELLING','DELIVERED','CANCELLED') NOT NULL,
	`cargo` json NOT NULL,
	`lossBp` smallint unsigned NOT NULL DEFAULT 0,
	`delayMinutes` smallint unsigned NOT NULL DEFAULT 0,
	`disruptedUntil` datetime(3),
	`checkpointsProcessed` tinyint unsigned NOT NULL DEFAULT 0,
	`path` json NOT NULL,
	`createdAt` datetime(3) NOT NULL,
	`departedAt` datetime(3),
	`arrivesAt` datetime(3),
	`resolvedAt` datetime(3),
	`version` int unsigned NOT NULL DEFAULT 0,
	CONSTRAINT `Caravan_id` PRIMARY KEY(`id`)
);

CREATE TABLE `CaravanDiscovery` (
	`caravanId` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`kind` enum('ROUTE','LOCATION') NOT NULL,
	`sector` smallint,
	`seenAt` datetime(3) NOT NULL,
	`expiresAt` datetime(3) NOT NULL,
	CONSTRAINT `CaravanDiscovery_caravanId_userId_kind_pk` PRIMARY KEY(`caravanId`,`userId`,`kind`)
);

CREATE TABLE `CaravanEncounter` (
	`id` varchar(191) NOT NULL,
	`type` enum('AMBUSH','INTERCEPTION','INTERVENTION','MARKER_ASSAULT') NOT NULL,
	`status` enum('PENDING','STARTING','FIGHTING','RESOLVED') NOT NULL,
	`caravanId` varchar(191),
	`markerId` varchar(191),
	`activeCaravanId` varchar(191),
	`activeMarkerId` varchar(191),
	`battleId` varchar(191),
	`leaderId` varchar(191),
	`attackersWon` boolean,
	`expiresAt` datetime(3),
	`createdAt` datetime(3) NOT NULL,
	`resolvedAt` datetime(3),
	CONSTRAINT `CaravanEncounter_id` PRIMARY KEY(`id`),
	CONSTRAINT `CaravanEncounter_activeCaravanId_key` UNIQUE(`activeCaravanId`),
	CONSTRAINT `CaravanEncounter_activeMarkerId_key` UNIQUE(`activeMarkerId`)
);

CREATE TABLE `CaravanOperation` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`activeUserId` varchar(191),
	`role` enum('GUARD','ENEMY','BANDIT') NOT NULL,
	`type` enum('INVESTIGATE','SEARCH','DISRUPT','DELAY') NOT NULL,
	`caravanId` varchar(191),
	`sector` smallint NOT NULL,
	`succeeds` boolean NOT NULL,
	`status` enum('ACTIVE','RESOLVED','INTERRUPTED') NOT NULL,
	`startedAt` datetime(3) NOT NULL,
	`finishesAt` datetime(3) NOT NULL,
	`resolvedAt` datetime(3),
	CONSTRAINT `CaravanOperation_id` PRIMARY KEY(`id`),
	CONSTRAINT `CaravanOperation_activeUserId_key` UNIQUE(`activeUserId`)
);

CREATE TABLE `CaravanParticipant` (
	`caravanId` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`role` enum('GUARD','ENEMY','BANDIT') NOT NULL,
	`activeUserId` varchar(191),
	`guardSlot` tinyint unsigned,
	`groupLeaderId` varchar(191),
	`objectives` smallint unsigned NOT NULL DEFAULT 0,
	`lastCheckpoint` tinyint unsigned NOT NULL DEFAULT 0,
	`loot` json,
	`lootClaimedAt` datetime(3),
	`rewardedAt` datetime(3),
	`joinedAt` datetime(3) NOT NULL,
	CONSTRAINT `CaravanParticipant_caravanId_userId_pk` PRIMARY KEY(`caravanId`,`userId`),
	CONSTRAINT `CaravanParticipant_activeUserId_key` UNIQUE(`activeUserId`),
	CONSTRAINT `CaravanParticipant_guardSlot_key` UNIQUE(`caravanId`,`guardSlot`)
);

CREATE TABLE `TradeRoute` (
	`id` varchar(191) NOT NULL,
	`villageIdA` varchar(191) NOT NULL,
	`villageIdB` varchar(191) NOT NULL,
	`openPair` varchar(383),
	`status` enum('PROPOSED','ACTIVE','CLOSED') NOT NULL,
	`proposedByVillageId` varchar(191) NOT NULL,
	`level` tinyint unsigned NOT NULL DEFAULT 1,
	`path` json NOT NULL,
	`createdAt` datetime(3) NOT NULL,
	`acceptedAt` datetime(3),
	`closedAt` datetime(3),
	CONSTRAINT `TradeRoute_id` PRIMARY KEY(`id`),
	CONSTRAINT `TradeRoute_openPair_key` UNIQUE(`openPair`)
);

CREATE TABLE `TradeRouteDiscovery` (
	`markerId` varchar(191) NOT NULL,
	`villageId` varchar(191) NOT NULL,
	`expiresAt` datetime(3) NOT NULL,
	CONSTRAINT `TradeRouteDiscovery_markerId_villageId_pk` PRIMARY KEY(`markerId`,`villageId`)
);

CREATE TABLE `TradeRouteMarker` (
	`id` varchar(191) NOT NULL,
	`routeId` varchar(191) NOT NULL,
	`sector` smallint NOT NULL,
	`controllerVillageId` varchar(191),
	`control` int NOT NULL DEFAULT 100,
	CONSTRAINT `TradeRouteMarker_id` PRIMARY KEY(`id`)
);

CREATE TABLE `VillageWarehouse` (
	`villageId` varchar(191) NOT NULL,
	`productionItemIds` json NOT NULL,
	`productionSettledAt` datetime(3) NOT NULL,
	`updatedAt` datetime(3) NOT NULL,
	CONSTRAINT `VillageWarehouse_villageId` PRIMARY KEY(`villageId`)
);

CREATE TABLE `WarehouseDepositLedger` (
	`userId` varchar(191) NOT NULL,
	`itemId` varchar(191) NOT NULL,
	`lastDepositAt` datetime(3),
	`withdrawnUnits` int unsigned NOT NULL DEFAULT 0,
	`bonusCarry` int unsigned NOT NULL DEFAULT 0,
	CONSTRAINT `WarehouseDepositLedger_userId_itemId_pk` PRIMARY KEY(`userId`,`itemId`)
);

CREATE TABLE `WarehouseLog` (
	`id` varchar(191) NOT NULL,
	`villageId` varchar(191) NOT NULL,
	`userId` varchar(191),
	`itemId` varchar(191),
	`type` enum('DEPOSIT','WITHDRAW','PRODUCTION','RESERVE','RELEASE','DISPATCH','DELIVERY') NOT NULL,
	`quantity` int NOT NULL,
	`createdAt` datetime(3) NOT NULL,
	CONSTRAINT `WarehouseLog_id` PRIMARY KEY(`id`)
);

CREATE TABLE `WarehouseMember` (
	`userId` varchar(191) NOT NULL,
	`allowanceDay` varchar(10),
	`allowanceUsed` int unsigned NOT NULL DEFAULT 0,
	`approvedVillageId` varchar(191),
	`approvedAt` datetime(3),
	`approvedWarId` varchar(191),
	CONSTRAINT `WarehouseMember_userId` PRIMARY KEY(`userId`)
);

CREATE TABLE `WarehouseStock` (
	`villageId` varchar(191) NOT NULL,
	`itemId` varchar(191) NOT NULL,
	`quantity` int unsigned NOT NULL DEFAULT 0,
	`reserved` int unsigned NOT NULL DEFAULT 0,
	CONSTRAINT `WarehouseStock_villageId_itemId_pk` PRIMARY KEY(`villageId`,`itemId`)
);

ALTER TABLE `Battle` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TERRITORY_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD','HUNTING','CARAVAN') NOT NULL;
ALTER TABLE `BattleHistory` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TERRITORY_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD','HUNTING','CARAVAN');
ALTER TABLE `DataBattleAction` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TERRITORY_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD','HUNTING','CARAVAN') NOT NULL;
ALTER TABLE `DataBattleTurnOrder` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TERRITORY_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD','HUNTING','CARAVAN') NOT NULL;
ALTER TABLE `LogTimeDurations` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TERRITORY_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD','HUNTING','CARAVAN') NOT NULL;
ALTER TABLE `LogRankedPicks` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TERRITORY_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD','HUNTING','CARAVAN') NOT NULL;
ALTER TABLE `Item` ADD `warehouseItem` boolean DEFAULT false NOT NULL;
ALTER TABLE `Item` ADD `villageId` varchar(191);
ALTER TABLE `UserData` ADD `isCaravanAi` boolean DEFAULT false NOT NULL;
ALTER TABLE `UserData` ADD `isBandit` boolean DEFAULT false NOT NULL;
ALTER TABLE `UserData` ADD `banditExperience` int DEFAULT 0 NOT NULL;
CREATE INDEX `Caravan_status_arrivesAt_idx` ON `Caravan` (`status`,`arrivesAt`);
CREATE INDEX `Caravan_originVillageId_status_idx` ON `Caravan` (`originVillageId`,`status`);
CREATE INDEX `Caravan_destinationVillageId_status_idx` ON `Caravan` (`destinationVillageId`,`status`);
CREATE INDEX `Caravan_routeId_status_idx` ON `Caravan` (`routeId`,`status`);
CREATE INDEX `Caravan_originVillageId_resolvedAt_idx` ON `Caravan` (`originVillageId`,`resolvedAt`);
CREATE INDEX `Caravan_destinationVillageId_resolvedAt_idx` ON `Caravan` (`destinationVillageId`,`resolvedAt`);
CREATE INDEX `CaravanDiscovery_userId_expiresAt_idx` ON `CaravanDiscovery` (`userId`,`expiresAt`);
CREATE INDEX `CaravanEncounter_caravanId_idx` ON `CaravanEncounter` (`caravanId`);
CREATE INDEX `CaravanEncounter_status_idx` ON `CaravanEncounter` (`status`);
CREATE INDEX `CaravanOperation_status_finishesAt_idx` ON `CaravanOperation` (`status`,`finishesAt`);
CREATE INDEX `CaravanOperation_caravanId_status_idx` ON `CaravanOperation` (`caravanId`,`status`);
CREATE INDEX `CaravanOperation_userId_startedAt_idx` ON `CaravanOperation` (`userId`,`startedAt`);
CREATE INDEX `CaravanParticipant_userId_idx` ON `CaravanParticipant` (`userId`);
CREATE INDEX `TradeRoute_villageIdA_idx` ON `TradeRoute` (`villageIdA`);
CREATE INDEX `TradeRoute_villageIdB_idx` ON `TradeRoute` (`villageIdB`);
CREATE INDEX `TradeRouteMarker_routeId_idx` ON `TradeRouteMarker` (`routeId`);
CREATE INDEX `TradeRouteMarker_sector_idx` ON `TradeRouteMarker` (`sector`);
CREATE INDEX `WarehouseLog_villageId_createdAt_idx` ON `WarehouseLog` (`villageId`,`createdAt`);
CREATE INDEX `WarehouseLog_userId_idx` ON `WarehouseLog` (`userId`);
CREATE INDEX `WarehouseMember_approvedVillageId_idx` ON `WarehouseMember` (`approvedVillageId`);
CREATE INDEX `WarehouseStock_itemId_idx` ON `WarehouseStock` (`itemId`);
CREATE INDEX `Item_warehouseItem_villageId_idx` ON `Item` (`warehouseItem`,`villageId`);
-- Every village and faction settlement gains an unbuilt Warehouse its leader can construct;
-- the Syndicate, which has no leader to build it, starts with a level 1 Warehouse. Each village's
-- Warehouse is painted in its own style; faction settlements share the Syndicate's.
INSERT INTO `VillageStructure` (`id`, `name`, `route`, `image`, `villageId`, `longitude`, `latitude`, `hasPage`, `curSp`, `maxSp`, `allyAccess`, `showInVillagePage`, `level`, `maxLevel`) SELECT CONCAT('warehouse-', v.`id`), 'Warehouse', '/warehouse', CASE v.`name` WHEN 'Akasumi' THEN 'https://ui0arpl8sm.ufs.sh/f/warehouse-akasumi-16aed1fd0a35ef4d5b767fd9.webp' WHEN 'Akikaze' THEN 'https://ui0arpl8sm.ufs.sh/f/warehouse-akikaze-6f417e5740f134213fda0142.webp' WHEN 'Freedom State' THEN 'https://ui0arpl8sm.ufs.sh/f/warehouse-freedom-state-7a5d5d252f66151d8e56d573.webp' WHEN 'Horizon' THEN 'https://ui0arpl8sm.ufs.sh/f/warehouse-horizon-62da57fab71ebdf0959f517d.webp' WHEN 'Hyorin' THEN 'https://ui0arpl8sm.ufs.sh/f/warehouse-hyorin-fdbc0c59327f740e77703eeb.webp' WHEN 'Shirohana' THEN 'https://ui0arpl8sm.ufs.sh/f/warehouse-shirohana-a0d57e27e724bc70393774e8.webp' WHEN 'Tsukimori' THEN 'https://ui0arpl8sm.ufs.sh/f/warehouse-tsukimori-bb63169e6711ae391fc53ad2.webp' ELSE 'https://ui0arpl8sm.ufs.sh/f/warehouse-syndicate-e798771eac9107e772a94735.webp' END, v.`id`, -1, -1, 1, 100, 100, 0, 1, CASE WHEN v.`type` = 'OUTLAW' THEN 1 ELSE 0 END, 10 FROM `Village` AS v WHERE v.`type` IN ('VILLAGE', 'HIDEOUT', 'STRONGHOLD', 'OUTLAW') AND NOT EXISTS (SELECT 1 FROM `VillageStructure` AS s WHERE s.`villageId` = v.`id` AND s.`route` = '/warehouse');
