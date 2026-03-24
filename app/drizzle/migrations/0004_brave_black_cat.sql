CREATE TABLE `VillageElderVote` (
	`id` varchar(191) NOT NULL,
	`villageId` varchar(191) NOT NULL,
	`type` enum('WAR_DECLARATION','KAGE_REMOVAL') NOT NULL,
	`initiatedByUserId` varchar(191) NOT NULL,
	`targetId` varchar(191) NOT NULL,
	`warType` enum('VILLAGE_WAR','SECTOR_WAR','WAR_RAID'),
	`targetStructureRoute` varchar(191),
	`status` enum('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
	`activeFlag` int GENERATED ALWAYS AS (CASE WHEN `status` = 'PENDING' THEN 1 ELSE NULL END) STORED,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`endsAt` datetime(3) NOT NULL,
	CONSTRAINT `VillageElderVote_id` PRIMARY KEY(`id`),
	CONSTRAINT `VillageElderVote_active_pending_unique` UNIQUE(`villageId`,`type`,`targetId`,`activeFlag`)
);

CREATE TABLE `VillageElderVoteEntry` (
	`id` varchar(191) NOT NULL,
	`voteId` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`vote` enum('YES','NO') NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `VillageElderVoteEntry_id` PRIMARY KEY(`id`),
	CONSTRAINT `VillageElderVoteEntry_voteId_userId_unique` UNIQUE(`voteId`,`userId`)
);

CREATE INDEX `VillageElderVote_villageId_idx` ON `VillageElderVote` (`villageId`);
CREATE INDEX `VillageElderVote_type_idx` ON `VillageElderVote` (`type`);
CREATE INDEX `VillageElderVote_status_idx` ON `VillageElderVote` (`status`);
CREATE INDEX `VillageElderVote_endsAt_idx` ON `VillageElderVote` (`endsAt`);
CREATE INDEX `VillageElderVote_initiatedByUserId_idx` ON `VillageElderVote` (`initiatedByUserId`);
CREATE INDEX `VillageElderVoteEntry_voteId_idx` ON `VillageElderVoteEntry` (`voteId`);
CREATE INDEX `VillageElderVoteEntry_userId_idx` ON `VillageElderVoteEntry` (`userId`);
