CREATE TABLE `ShrineBoostSchedule` (
	`id` varchar(191) NOT NULL,
	`villageId` varchar(191) NOT NULL,
	`boostType` enum('Training','PVP','Mission','Errands','Crafting') NOT NULL,
	`startAt` datetime(3) NOT NULL,
	`endAt` datetime(3) NOT NULL,
	`createdByUserId` varchar(191) NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `ShrineBoostSchedule_id` PRIMARY KEY(`id`)
);

CREATE INDEX `ShrineBoostSchedule_villageId_idx` ON `ShrineBoostSchedule` (`villageId`);
CREATE INDEX `ShrineBoostSchedule_boostType_idx` ON `ShrineBoostSchedule` (`boostType`);
CREATE INDEX `ShrineBoostSchedule_startAt_idx` ON `ShrineBoostSchedule` (`startAt`);
CREATE INDEX `ShrineBoostSchedule_endAt_idx` ON `ShrineBoostSchedule` (`endAt`);