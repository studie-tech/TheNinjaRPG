CREATE TABLE `UserLiveActivity` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`activityId` varchar(191) NOT NULL,
	`kind` enum('hospital','training','war') NOT NULL,
	`pushToken` varchar(512) NOT NULL,
	`endsAt` datetime(3) NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `UserLiveActivity_id` PRIMARY KEY(`id`),
	CONSTRAINT `UserLiveActivity_userId_kind_key` UNIQUE(`userId`,`kind`)
);

CREATE INDEX `UserLiveActivity_activityId_idx` ON `UserLiveActivity` (`activityId`);
CREATE INDEX `UserLiveActivity_endsAt_idx` ON `UserLiveActivity` (`endsAt`);