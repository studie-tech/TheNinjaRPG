CREATE TABLE `KessenDeck` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`name` varchar(64) NOT NULL,
	`leaderItemId` varchar(191) NOT NULL,
	`cards` json NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `KessenDeck_id` PRIMARY KEY(`id`)
);

CREATE TABLE `KessenMatch` (
	`id` varchar(191) NOT NULL,
	`kind` enum('NPC','FRIENDLY','RANKED') NOT NULL DEFAULT 'NPC',
	`userId` varchar(191) NOT NULL,
	`opponentId` varchar(191),
	`npcKey` varchar(64),
	`tier` enum('GENIN','CHUNIN','JONIN','KAGE'),
	`deckId` varchar(191),
	`status` enum('ACTIVE','FINISHED','EXPIRED','CONCEDED') NOT NULL DEFAULT 'ACTIVE',
	`version` int NOT NULL DEFAULT 1,
	`engineVersion` int NOT NULL,
	`seed` varchar(191) NOT NULL,
	`state` json NOT NULL,
	`rewarded` boolean NOT NULL DEFAULT false,
	`rated` boolean NOT NULL DEFAULT false,
	`turnDeadline` datetime(3),
	`startedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`finishedAt` datetime(3),
	CONSTRAINT `KessenMatch_id` PRIMARY KEY(`id`)
);

CREATE TABLE `KessenNpcProgress` (
	`userId` varchar(191) NOT NULL,
	`npcKey` varchar(64) NOT NULL,
	`wins` int NOT NULL DEFAULT 0,
	`firstWinAt` datetime(3),
	`ascendedFirstWinAt` datetime(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `KessenNpcProgress_userId_npcKey_pk` PRIMARY KEY(`userId`,`npcKey`)
);

CREATE TABLE `KessenProgress` (
	`userId` varchar(191) NOT NULL,
	`packsSinceEpic` int NOT NULL DEFAULT 0,
	`packsSinceLegendary` int NOT NULL DEFAULT 0,
	`firstBundleOpened` boolean NOT NULL DEFAULT false,
	`starterFaction` varchar(32),
	`starterGranted` boolean NOT NULL DEFAULT false,
	`academy` json NOT NULL,
	`academyGraduatedMatchId` varchar(191),
	`seenKeywords` json NOT NULL,
	`dayKey` varchar(10) NOT NULL DEFAULT '',
	`rewardedToday` int NOT NULL DEFAULT 0,
	`dropsToday` int NOT NULL DEFAULT 0,
	`npcWinsToday` json NOT NULL,
	`weekKey` varchar(10) NOT NULL DEFAULT '',
	`weeklyWins` int NOT NULL DEFAULT 0,
	`rewardedMatchId` varchar(191),
	`autoSellSurplus` boolean NOT NULL DEFAULT false,
	`rating` int NOT NULL DEFAULT 1000,
	`rankedPlayed` int NOT NULL DEFAULT 0,
	`rankedWins` int NOT NULL DEFAULT 0,
	`rankedLosses` int NOT NULL DEFAULT 0,
	`rankedDraws` int NOT NULL DEFAULT 0,
	`rankedRewardDay` varchar(10) NOT NULL DEFAULT '',
	`rankedRewardsToday` int NOT NULL DEFAULT 0,
	`rankedWeekKey` varchar(10) NOT NULL DEFAULT '',
	`rankedWeeklyWins` int NOT NULL DEFAULT 0,
	`rankedRewardMatchId` varchar(191),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `KessenProgress_userId` PRIMARY KEY(`userId`)
);

CREATE TABLE `KessenRankedQueue` (
	`userId` varchar(191) NOT NULL,
	`rating` int NOT NULL,
	`deck` json NOT NULL,
	`queuedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`seenAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`matchId` varchar(191),
	`matchedAt` datetime(3),
	CONSTRAINT `KessenRankedQueue_userId` PRIMARY KEY(`userId`)
);

ALTER TABLE `Item` MODIFY COLUMN `itemType` enum('WEAPON','CONSUMABLE','ARMOR','ACCESSORY','MATERIAL','COOKING','MEAL','KEYSTONE','CRYSTAL','FURNITURE','COSMETIC','CARD','OTHER') NOT NULL;
ALTER TABLE `Item` MODIFY COLUMN `crystalTargetTypes` enum('WEAPON','CONSUMABLE','ARMOR','ACCESSORY','MATERIAL','COOKING','MEAL','KEYSTONE','CRYSTAL','FURNITURE','COSMETIC','CARD','OTHER');
ALTER TABLE `UserRequest` MODIFY COLUMN `type` enum('SPAR','ALLIANCE','SURRENDER','SENSEI','ANBU','CLAN','MARRIAGE','KAGE','WAR_ALLY','HOME','KESSEN') NOT NULL;
ALTER TABLE `Item` ADD `cardData` json;
ALTER TABLE `UserRequest` ADD `pendingKessenPair` varchar(383) GENERATED ALWAYS AS (CASE WHEN `type` = 'KESSEN' AND `status` = 'PENDING' THEN CONCAT(LEAST(`senderId`, `receiverId`), ':', GREATEST(`senderId`, `receiverId`)) ELSE NULL END) STORED;
ALTER TABLE `UserRequest` ADD CONSTRAINT `UserRequest_pending_kessen_pair_unique` UNIQUE(`pendingKessenPair`);
CREATE INDEX `KessenDeck_userId_idx` ON `KessenDeck` (`userId`);
CREATE INDEX `KessenMatch_userId_status_idx` ON `KessenMatch` (`userId`,`status`);
CREATE INDEX `KessenMatch_opponentId_status_idx` ON `KessenMatch` (`opponentId`,`status`);
CREATE INDEX `KessenMatch_status_updatedAt_idx` ON `KessenMatch` (`status`,`updatedAt`);
CREATE INDEX `KessenMatch_status_turnDeadline_idx` ON `KessenMatch` (`status`,`turnDeadline`);
CREATE INDEX `KessenRankedQueue_matchId_idx` ON `KessenRankedQueue` (`matchId`);