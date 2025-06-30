CREATE TABLE `RankedLoadout` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`loadout` json NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `RankedLoadout_id` PRIMARY KEY(`id`)
);

CREATE TABLE `RankedPvpQueue` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`rankedLp` int NOT NULL,
	`queueStartTime` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `RankedPvpQueue_id` PRIMARY KEY(`id`)
);

CREATE TABLE `RankedSeason` (
	`id` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL,
	`description` text NOT NULL,
	`startDate` datetime(3) NOT NULL,
	`endDate` datetime(3) NOT NULL,
	`rewards` json NOT NULL,
	`ended` boolean NOT NULL DEFAULT false,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `RankedSeason_id` PRIMARY KEY(`id`)
);

CREATE TABLE `RankedUserRewards` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`seasonId` varchar(191) NOT NULL,
	`division` enum('Unranked','Wood','Adept','Master','Legend','Sannin') NOT NULL,
	`claimed` boolean NOT NULL DEFAULT false,
	`claimedAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `RankedUserRewards_id` PRIMARY KEY(`id`)
);

ALTER TABLE `Battle` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP') NOT NULL;
ALTER TABLE `BattleHistory` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP');
ALTER TABLE `DataBattleAction` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP') NOT NULL;
ALTER TABLE `UserData` ADD `rankedLoadout` varchar(191);
ALTER TABLE `UserData` ADD `rankedLp` int DEFAULT 0 NOT NULL;
ALTER TABLE `UserData` ADD `rankedBattles` int DEFAULT 0 NOT NULL;
ALTER TABLE `UserData` ADD `rankedWins` int DEFAULT 0 NOT NULL;
ALTER TABLE `UserData` ADD `rankedStreak` int DEFAULT 0 NOT NULL;
CREATE INDEX `RankedPvpQueue_userId_idx` ON `RankedPvpQueue` (`userId`);
CREATE INDEX `RankedPvpQueue_rankedLp_idx` ON `RankedPvpQueue` (`rankedLp`);
CREATE INDEX `UserData_rankedLoadout_idx` ON `UserData` (`rankedLoadout`);