CREATE TABLE `RaidDamageThreshold` (
	`id` varchar(191) NOT NULL,
	`questId` varchar(191) NOT NULL,
	`damageRequired` bigint NOT NULL,
	`sortOrder` tinyint NOT NULL DEFAULT 0,
	`rewards` json NOT NULL,
	`effects` json NOT NULL DEFAULT ('[]'),
	`effectDurationMinutes` int NOT NULL DEFAULT 60,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `RaidDamageThreshold_id` PRIMARY KEY(`id`)
);

CREATE TABLE `RaidParticipation` (
	`id` varchar(191) NOT NULL,
	`questId` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`damageDealt` bigint NOT NULL DEFAULT 0,
	`battleCount` int NOT NULL DEFAULT 0,
	`rewardsClaimed` json NOT NULL DEFAULT ('[]'),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `RaidParticipation_id` PRIMARY KEY(`id`),
	CONSTRAINT `RaidParticipation_questId_userId` UNIQUE(`questId`,`userId`)
);

CREATE TABLE `UserRaidBuff` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`questId` varchar(191) NOT NULL,
	`effects` json NOT NULL DEFAULT ('[]'),
	`expiresAt` datetime(3) NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `UserRaidBuff_id` PRIMARY KEY(`id`)
);

ALTER TABLE `Battle` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID') NOT NULL;
ALTER TABLE `BattleHistory` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID');
ALTER TABLE `DataBattleAction` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID') NOT NULL;
ALTER TABLE `LogTimeDurations` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID') NOT NULL;
ALTER TABLE `LogRankedPicks` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID') NOT NULL;
ALTER TABLE `MpvpBattleQueue` MODIFY COLUMN `battleType` enum('CLAN_BATTLE','SHRINE_BATTLE','RAID_BATTLE') NOT NULL DEFAULT 'CLAN_BATTLE';
ALTER TABLE `Quest` MODIFY COLUMN `questType` enum('starter','tier','daily','mission','errand','crime','exam','event','story','anbu','medical','hunting','gathering','battlepyramid','pvp','achievement','war','raid') NOT NULL;
ALTER TABLE `QuestHistory` MODIFY COLUMN `questType` enum('starter','tier','daily','mission','errand','crime','exam','event','story','anbu','medical','hunting','gathering','battlepyramid','pvp','achievement','war','raid') NOT NULL;
ALTER TABLE `Quest` ADD `raidBossMaxHealth` bigint;
ALTER TABLE `Quest` ADD `raidBossCurrentHealth` bigint;
ALTER TABLE `Quest` ADD `raidEndsAt` datetime(3);
ALTER TABLE `Quest` ADD `raidCaptureDeadline` datetime(3);
ALTER TABLE `Quest` ADD `raidGracePeriodEnd` datetime(3);
CREATE INDEX `RaidDamageThreshold_questId_idx` ON `RaidDamageThreshold` (`questId`);
CREATE INDEX `RaidDamageThreshold_sortOrder_idx` ON `RaidDamageThreshold` (`sortOrder`);
CREATE INDEX `RaidParticipation_questId_idx` ON `RaidParticipation` (`questId`);
CREATE INDEX `RaidParticipation_userId_idx` ON `RaidParticipation` (`userId`);
CREATE INDEX `RaidParticipation_damageDealt_idx` ON `RaidParticipation` (`damageDealt`);
CREATE INDEX `RaidParticipation_questId_damageDealt_idx` ON `RaidParticipation` (`questId`,`damageDealt`);
CREATE INDEX `UserRaidBuff_userId_idx` ON `UserRaidBuff` (`userId`);
CREATE INDEX `UserRaidBuff_questId_idx` ON `UserRaidBuff` (`questId`);
CREATE INDEX `UserRaidBuff_expiresAt_idx` ON `UserRaidBuff` (`expiresAt`);
CREATE INDEX `UserRaidBuff_userId_expiresAt_idx` ON `UserRaidBuff` (`userId`,`expiresAt`);
CREATE INDEX `Quest_raidEndsAt_idx` ON `Quest` (`raidEndsAt`);