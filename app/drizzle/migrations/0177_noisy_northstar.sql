CREATE TABLE `DataBattleTurnOrder` (
	`battleId` varchar(191) NOT NULL,
	`periodStart` int NOT NULL,
	`battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TERRITORY_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD','HUNTING') NOT NULL,
	`firstUserId` varchar(191) NOT NULL,
	`firstLevel` int NOT NULL DEFAULT 0,
	`firstRank` enum('STUDENT','GENIN','CHUNIN','JONIN','ELITE JONIN','ELDER','NONE') NOT NULL DEFAULT 'NONE',
	`secondUserId` varchar(191) NOT NULL,
	`secondLevel` int NOT NULL DEFAULT 0,
	`secondRank` enum('STUDENT','GENIN','CHUNIN','JONIN','ELITE JONIN','ELDER','NONE') NOT NULL DEFAULT 'NONE',
	`winner` tinyint NOT NULL DEFAULT 0,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `DataBattleTurnOrder_battleId` PRIMARY KEY(`battleId`)
);

CREATE INDEX `DataBattleTurnOrder_period_idx` ON `DataBattleTurnOrder` (`periodStart`);
CREATE INDEX `DataBattleTurnOrder_firstUserId_idx` ON `DataBattleTurnOrder` (`firstUserId`);
CREATE INDEX `DataBattleTurnOrder_secondUserId_idx` ON `DataBattleTurnOrder` (`secondUserId`);