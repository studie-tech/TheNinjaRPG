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
	`positionVersion` int NOT NULL DEFAULT 0,
	CONSTRAINT `OverworldAiPlacement_id` PRIMARY KEY(`id`)
);

CREATE TABLE `OverworldAiPlacementQuest` (
	`placementId` varchar(191) NOT NULL,
	`questId` varchar(191) NOT NULL,
	`chance` smallint unsigned NOT NULL DEFAULT 0,
	CONSTRAINT `OverworldAiPlacementQuest_placementId_questId_pk` PRIMARY KEY(`placementId`,`questId`)
);

CREATE TABLE `UserQuestAttempt` (
	`userId` varchar(191) NOT NULL,
	`questId` varchar(191) NOT NULL,
	`lastAttemptAt` datetime(3) NOT NULL,
	CONSTRAINT `UserQuestAttempt_userId_questId_pk` PRIMARY KEY(`userId`,`questId`)
);

ALTER TABLE `Battle` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD') NOT NULL;
ALTER TABLE `BattleHistory` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD');
ALTER TABLE `DataBattleAction` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD') NOT NULL;
ALTER TABLE `LogTimeDurations` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD') NOT NULL;
ALTER TABLE `LogRankedPicks` MODIFY COLUMN `battleType` enum('ARENA','COMBAT','SPARRING','KAGE_AI','KAGE_PVP','CLAN_CHALLENGE','CLAN_BATTLE','SHRINE_WAR','TOURNAMENT','QUEST','RANDOM_ENCOUNTER','VILLAGE_PROTECTOR','TRAINING','RANKED_PVP','RANKED_SPARRING','RAID','OVERWORLD') NOT NULL;
ALTER TABLE `Quest` ADD `attemptDelay` enum('daily','weekly','monthly','none') DEFAULT 'none' NOT NULL;
ALTER TABLE `QuestHistory` ADD `periodCompletes` int DEFAULT 0 NOT NULL;
ALTER TABLE `QuestHistory` ADD `periodStartAt` datetime(3);
ALTER TABLE `UserData` ADD `activeNpcQuestId` varchar(191);
ALTER TABLE `UserData` ADD `dailyOverworldQuestRolls` smallint unsigned DEFAULT 0 NOT NULL;
-- Preserve one-shot content authored under the old lifetime-cap semantics. A quest that could
-- only ever complete once gained no useful retry window, so opting it out of the new periodic
-- interpretation is the backward-compatible choice.
UPDATE `Quest`
SET `retryDelay` = 'none'
WHERE `retryDelay` <> 'none' AND `maxCompletes` <= 1;

-- Existing repeatable quests used the old "one completion, then wait" behavior. If their last
-- completion falls in the current UTC calendar period, consume the new period allowance so
-- deployment cannot immediately grant extra attempts merely because the new columns start at zero.
UPDATE `QuestHistory` AS `qh`
INNER JOIN `Quest` AS `q` ON `q`.`id` = `qh`.`questId`
SET
	`qh`.`periodCompletes` = `q`.`maxCompletes`,
	`qh`.`periodStartAt` = CASE `q`.`retryDelay`
		WHEN 'daily' THEN UTC_DATE()
		WHEN 'weekly' THEN DATE_SUB(UTC_DATE(), INTERVAL WEEKDAY(UTC_DATE()) DAY)
		WHEN 'monthly' THEN CAST(DATE_FORMAT(UTC_DATE(), '%Y-%m-01') AS DATETIME)
		ELSE NULL
	END
WHERE
	`qh`.`completed` = 1
	AND `q`.`retryDelay` <> 'none'
	AND `q`.`maxCompletes` > 1
	AND `qh`.`endedAt` >= CASE `q`.`retryDelay`
		WHEN 'daily' THEN UTC_DATE()
		WHEN 'weekly' THEN DATE_SUB(UTC_DATE(), INTERVAL WEEKDAY(UTC_DATE()) DAY)
		WHEN 'monthly' THEN CAST(DATE_FORMAT(UTC_DATE(), '%Y-%m-01') AS DATETIME)
		ELSE NULL
	END;
CREATE INDEX `OverworldAiPlacement_aiTemplateUserId_idx` ON `OverworldAiPlacement` (`aiTemplateUserId`);
CREATE INDEX `OverworldAiPlacement_isActive_sector_idx` ON `OverworldAiPlacement` (`isActive`,`sector`);
CREATE INDEX `OverworldAiPlacementQuest_questId_idx` ON `OverworldAiPlacementQuest` (`questId`);
CREATE INDEX `UserQuestAttempt_questId_idx` ON `UserQuestAttempt` (`questId`);
