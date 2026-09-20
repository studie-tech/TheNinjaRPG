CREATE TABLE `FishingActivity` (
	`userId` varchar(191) NOT NULL,
	`sessionId` varchar(191) NOT NULL,
	`sector` int NOT NULL,
	`interactedAt` datetime(3) NOT NULL,
	CONSTRAINT `FishingActivity_userId` PRIMARY KEY(`userId`)
);

CREATE TABLE `FishingCatchReceipt` (
	`sessionId` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`speciesId` varchar(64) NOT NULL,
	`itemId` varchar(191),
	`keep` boolean NOT NULL,
	`experience` int NOT NULL,
	`deliveredAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `FishingCatchReceipt_sessionId` PRIMARY KEY(`sessionId`)
);

CREATE TABLE `FishingCollectionLog` (
	`userId` varchar(191) NOT NULL,
	`speciesId` varchar(64) NOT NULL,
	`caughtCount` int unsigned NOT NULL DEFAULT 0,
	`firstCaughtAt` datetime(3) NOT NULL,
	`largestSize` smallint unsigned NOT NULL DEFAULT 0,
	`bestQuality` tinyint unsigned NOT NULL DEFAULT 0,
	CONSTRAINT `FishingCollectionLog_userId_speciesId_pk` PRIMARY KEY(`userId`,`speciesId`)
);

CREATE TABLE `FishingHabitat` (
	`id` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL,
	`sector` int NOT NULL,
	`tileX` smallint unsigned NOT NULL,
	`tileY` smallint unsigned NOT NULL,
	`radius` tinyint unsigned NOT NULL DEFAULT 1,
	`speciesIds` json NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `FishingHabitat_id` PRIMARY KEY(`id`)
);

CREATE TABLE `FishingProfile` (
	`userId` varchar(191) NOT NULL,
	`tutorialClaimedAt` datetime(3),
	`starterRecoveryClaimedAt` datetime(3),
	`trackedSpeciesId` varchar(64),
	`lastSchoolMarkedAt` datetime(3),
	`activeSessionId` varchar(191),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `FishingProfile_userId` PRIMARY KEY(`userId`)
);

CREATE TABLE `FishingRaidEncounter` (
	`lobbyId` varchar(191) NOT NULL,
	`state` enum('HOOK','CONTROL','WEAR_DOWN','SURGE','LAND','SUCCEEDED','FAILED') NOT NULL DEFAULT 'HOOK',
	`version` int NOT NULL DEFAULT 1,
	`phase` tinyint unsigned NOT NULL DEFAULT 1,
	`fishStamina` tinyint unsigned NOT NULL DEFAULT 100,
	`landingProgress` tinyint unsigned NOT NULL DEFAULT 0,
	`escapePressure` tinyint unsigned NOT NULL DEFAULT 0,
	`deadlineAt` datetime(3) NOT NULL,
	`recoveryUntil` datetime(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `FishingRaidEncounter_lobbyId` PRIMARY KEY(`lobbyId`)
);

CREATE TABLE `FishingRaidLobby` (
	`id` varchar(191) NOT NULL,
	`occurrenceId` varchar(191) NOT NULL,
	`hostUserId` varchar(191) NOT NULL,
	`state` enum('OPEN','STARTING','ACTIVE','SUCCEEDED','FAILED','CANCELLED') NOT NULL DEFAULT 'OPEN',
	`version` int NOT NULL DEFAULT 1,
	`rosterLockedAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `FishingRaidLobby_id` PRIMARY KEY(`id`)
);

CREATE TABLE `FishingRaidOccurrence` (
	`id` varchar(191) NOT NULL,
	`scheduleId` varchar(191) NOT NULL,
	`templateId` varchar(191) NOT NULL,
	`templateVersion` int NOT NULL,
	`templateConfig` json NOT NULL,
	`opensAt` datetime(3) NOT NULL,
	`closesAt` datetime(3) NOT NULL,
	`state` enum('SCHEDULED','OPEN','CLOSED','CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `FishingRaidOccurrence_id` PRIMARY KEY(`id`),
	CONSTRAINT `FishingRaidOccurrence_schedule_opensAt_key` UNIQUE(`scheduleId`,`opensAt`)
);

CREATE TABLE `FishingRaidParticipant` (
	`lobbyId` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`rodUserItemId` varchar(191),
	`baitUserItemId` varchar(191),
	`tackleUserItemId` varchar(191),
	`role` enum('PULLER','ANCHOR','GUIDE') NOT NULL DEFAULT 'PULLER',
	`ready` boolean NOT NULL DEFAULT false,
	`active` boolean NOT NULL DEFAULT true,
	`contribution` int unsigned NOT NULL DEFAULT 0,
	`lineTension` tinyint unsigned NOT NULL DEFAULT 0,
	`reattachments` tinyint unsigned NOT NULL DEFAULT 2,
	`lastActionPhase` tinyint unsigned NOT NULL DEFAULT 0,
	`lastActionAt` datetime(3),
	`reconnectUntil` datetime(3),
	`joinedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `FishingRaidParticipant_lobbyId_userId_pk` PRIMARY KEY(`lobbyId`,`userId`)
);

CREATE TABLE `FishingRaidRewardReceipt` (
	`occurrenceId` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`lobbyId` varchar(191) NOT NULL,
	`experience` int unsigned NOT NULL,
	`contribution` int unsigned NOT NULL,
	`deliveredAt` datetime(3) NOT NULL,
	CONSTRAINT `FishingRaidRewardReceipt_occurrenceId_userId_pk` PRIMARY KEY(`occurrenceId`,`userId`)
);

CREATE TABLE `FishingRaidSchedule` (
	`id` varchar(191) NOT NULL,
	`templateId` varchar(191) NOT NULL,
	`startsAt` datetime(3) NOT NULL,
	`recurrenceMinutes` int unsigned,
	`spawnWindowSeconds` smallint unsigned NOT NULL DEFAULT 900,
	`announcementLeadSeconds` smallint unsigned NOT NULL DEFAULT 900,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `FishingRaidSchedule_id` PRIMARY KEY(`id`)
);

CREATE TABLE `FishingRaidTemplate` (
	`id` varchar(191) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`name` varchar(191) NOT NULL,
	`speciesId` varchar(64) NOT NULL,
	`habitatId` varchar(191) NOT NULL,
	`minimumLevel` smallint unsigned NOT NULL DEFAULT 1,
	`minimumParticipants` tinyint unsigned NOT NULL DEFAULT 3,
	`maximumParticipants` tinyint unsigned NOT NULL DEFAULT 8,
	`entryBait` tinyint unsigned NOT NULL DEFAULT 1,
	`encounterSeconds` smallint unsigned NOT NULL DEFAULT 240,
	`rewardExperience` int unsigned NOT NULL DEFAULT 100,
	`maxRewardsPerOccurrence` tinyint unsigned NOT NULL DEFAULT 1,
	`active` boolean NOT NULL DEFAULT true,
	`config` json NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `FishingRaidTemplate_id` PRIMARY KEY(`id`)
);

CREATE TABLE `FishingSchoolMark` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`sector` int NOT NULL,
	`habitatId` varchar(191) NOT NULL,
	`markedAt` datetime(3) NOT NULL,
	CONSTRAINT `FishingSchoolMark_id` PRIMARY KEY(`id`)
);

CREATE TABLE `FishingSession` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`speciesId` varchar(64) NOT NULL,
	`sector` int NOT NULL,
	`castLongitude` smallint NOT NULL,
	`castLatitude` smallint NOT NULL,
	`state` enum('ATTRACT','HOOK','FIGHT','LANDED','FAILED','RESOLVED') NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`tension` tinyint unsigned NOT NULL DEFAULT 20,
	`landingProgress` tinyint unsigned NOT NULL DEFAULT 0,
	`socialBonusPercent` tinyint unsigned NOT NULL DEFAULT 0,
	`socialParticipantCount` tinyint unsigned NOT NULL DEFAULT 1,
	`equipmentAttractionBonus` tinyint unsigned NOT NULL DEFAULT 0,
	`equipmentControlBonus` tinyint unsigned NOT NULL DEFAULT 0,
	`equipmentExperienceBonus` tinyint unsigned NOT NULL DEFAULT 0,
	`startedAt` datetime(3) NOT NULL,
	`actionAt` datetime(3) NOT NULL,
	`expiresAt` datetime(3) NOT NULL,
	`resolvedAt` datetime(3),
	CONSTRAINT `FishingSession_id` PRIMARY KEY(`id`)
);

ALTER TABLE `UserData` ADD `fishingExperience` int DEFAULT 0 NOT NULL;
CREATE INDEX `FishingActivity_sector_interacted_idx` ON `FishingActivity` (`sector`,`interactedAt`);
CREATE INDEX `FishingCatchReceipt_user_delivered_idx` ON `FishingCatchReceipt` (`userId`,`deliveredAt`);
CREATE INDEX `FishingCollectionLog_speciesId_idx` ON `FishingCollectionLog` (`speciesId`);
CREATE INDEX `FishingHabitat_sector_active_idx` ON `FishingHabitat` (`sector`,`active`);
CREATE INDEX `FishingRaidLobby_occurrence_state_idx` ON `FishingRaidLobby` (`occurrenceId`,`state`);
CREATE INDEX `FishingRaidOccurrence_state_opensAt_idx` ON `FishingRaidOccurrence` (`state`,`opensAt`);
CREATE INDEX `FishingRaidParticipant_user_active_idx` ON `FishingRaidParticipant` (`userId`,`active`);
CREATE INDEX `FishingRaidRewardReceipt_user_delivered_idx` ON `FishingRaidRewardReceipt` (`userId`,`deliveredAt`);
CREATE INDEX `FishingRaidSchedule_template_active_idx` ON `FishingRaidSchedule` (`templateId`,`active`);
CREATE INDEX `FishingSchoolMark_sector_marked_idx` ON `FishingSchoolMark` (`sector`,`markedAt`);
CREATE INDEX `FishingSchoolMark_user_marked_idx` ON `FishingSchoolMark` (`userId`,`markedAt`);
CREATE INDEX `FishingSession_user_state_idx` ON `FishingSession` (`userId`,`state`);
CREATE INDEX `FishingSession_expiresAt_idx` ON `FishingSession` (`expiresAt`);

INSERT INTO `Item` (`id`, `name`, `description`, `effects`, `itemType`, `rarity`, `slot`, `target`, `image`, `canStack`, `stackSize`, `hidden`, `inShop`, `canBeTraded`, `cost`) VALUES
	('fishing-river-carp', 'River Carp', 'A freshly caught river carp.', '[]', 'COOKING', 'COMMON', 'NONE', 'CHARACTER', '', true, 99, false, false, true, 5),
	('fishing-pond-bluegill', 'Pond Bluegill', 'A freshly caught pond bluegill.', '[]', 'COOKING', 'COMMON', 'NONE', 'CHARACTER', '', true, 99, false, false, true, 5),
	('fishing-marsh-catfish', 'Marsh Catfish', 'A freshly caught marsh catfish.', '[]', 'COOKING', 'COMMON', 'NONE', 'CHARACTER', '', true, 99, false, false, true, 5),
	('fishing-river-trout', 'River Trout', 'A freshly caught river trout.', '[]', 'COOKING', 'RARE', 'NONE', 'CHARACTER', '', true, 99, false, false, true, 10),
	('fishing-lake-perch', 'Lake Perch', 'A freshly caught lake perch.', '[]', 'COOKING', 'RARE', 'NONE', 'CHARACTER', '', true, 99, false, false, true, 10),
	('fishing-tidal-mullet', 'Tidal Mullet', 'A freshly caught tidal mullet.', '[]', 'COOKING', 'COMMON', 'NONE', 'CHARACTER', '', true, 99, false, false, true, 5),
	('fishing-silver-koi', 'Silver Koi', 'A freshly caught silver koi.', '[]', 'COOKING', 'RARE', 'NONE', 'CHARACTER', '', true, 99, false, false, true, 20),
	('fishing-marsh-pike', 'Marsh Pike', 'A freshly caught marsh pike.', '[]', 'COOKING', 'RARE', 'NONE', 'CHARACTER', '', true, 99, false, false, true, 10),
	('fishing-moon-eel', 'Moon Eel', 'A freshly caught moon eel.', '[]', 'COOKING', 'RARE', 'NONE', 'CHARACTER', '', true, 99, false, false, true, 20),
	('fishing-reef-runner', 'Reef Runner', 'A freshly caught reef runner.', '[]', 'COOKING', 'RARE', 'NONE', 'CHARACTER', '', true, 99, false, false, true, 10),
	('fishing-storm-ray', 'Storm Ray', 'A freshly caught storm ray.', '[]', 'COOKING', 'RARE', 'NONE', 'CHARACTER', '', true, 99, false, false, true, 20),
	('fishing-glassfin', 'Glassfin', 'A freshly caught glassfin.', '[]', 'COOKING', 'RARE', 'NONE', 'CHARACTER', '', true, 99, false, false, true, 20),
	('fishing-bamboo-rod', 'Bamboo Rod', 'Fishing rod — +0% attraction, +0 control, +0% XP.', '[]', 'OTHER', 'COMMON', 'NONE', 'CHARACTER', '', false, 1, false, false, false, 0),
	('fishing-willow-rod', 'Willow Rod', 'Fishing rod — +4% attraction, +3 control, +0% XP.', '[]', 'OTHER', 'COMMON', 'NONE', 'CHARACTER', '', false, 1, false, true, true, 1500),
	('fishing-river-rod', 'River Rod', 'Fishing rod — +6% attraction, +4 control, +5% XP.', '[]', 'OTHER', 'COMMON', 'NONE', 'CHARACTER', '', false, 1, false, true, true, 5000),
	('fishing-starter-grub', 'Starter Grub', 'Fishing bait — +0% attraction, +0 control, +0% XP.', '[]', 'OTHER', 'COMMON', 'NONE', 'CHARACTER', '', true, 99, false, false, false, 0),
	('fishing-cricket-bait', 'Cricket Bait', 'Fishing bait — +8% attraction, +0 control, +0% XP.', '[]', 'OTHER', 'COMMON', 'NONE', 'CHARACTER', '', true, 99, false, true, true, 25),
	('fishing-glow-bait', 'Glow Bait', 'Fishing bait — +4% attraction, +1 control, +4% XP.', '[]', 'OTHER', 'COMMON', 'NONE', 'CHARACTER', '', true, 99, false, true, true, 25),
	('fishing-cork-bobber', 'Cork Bobber', 'Fishing tackle — +3% attraction, +0 control, +0% XP.', '[]', 'OTHER', 'COMMON', 'NONE', 'CHARACTER', '', false, 1, false, true, true, 800),
	('fishing-silk-line', 'Silk Line', 'Fishing tackle — +0% attraction, +5 control, +2% XP.', '[]', 'OTHER', 'COMMON', 'NONE', 'CHARACTER', '', false, 1, false, true, true, 800)
ON DUPLICATE KEY UPDATE
	`name` = VALUES(`name`),
	`description` = VALUES(`description`),
	`effects` = VALUES(`effects`),
	`itemType` = VALUES(`itemType`),
	`rarity` = VALUES(`rarity`),
	`slot` = VALUES(`slot`),
	`target` = VALUES(`target`),
	`image` = VALUES(`image`),
	`canStack` = VALUES(`canStack`),
	`stackSize` = VALUES(`stackSize`),
	`hidden` = VALUES(`hidden`),
	`inShop` = VALUES(`inShop`),
	`canBeTraded` = VALUES(`canBeTraded`),
	`cost` = VALUES(`cost`);
