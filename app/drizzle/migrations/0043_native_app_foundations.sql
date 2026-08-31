CREATE TABLE `StorePurchase` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`transactionId` varchar(191) NOT NULL,
	`productId` varchar(191) NOT NULL,
	`store` enum('APPLE','GOOGLE') NOT NULL,
	`reputationPoints` int NOT NULL DEFAULT 0,
	`federalStatus` enum('NONE','NORMAL','SILVER','GOLD'),
	`isSandbox` boolean NOT NULL DEFAULT false,
	`acceptedAt` datetime(3),
	`revokedAt` datetime(3),
	`rawData` json NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `StorePurchase_id` PRIMARY KEY(`id`),
	CONSTRAINT `StorePurchase_transactionId_key` UNIQUE(`transactionId`)
);

CREATE TABLE `UserDevice` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`token` varchar(512) NOT NULL,
	`platform` enum('ios','android','web') NOT NULL,
	`appVersion` varchar(32),
	`locale` varchar(16),
	`widgetToken` varchar(191),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`lastSeenAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `UserDevice_id` PRIMARY KEY(`id`),
	CONSTRAINT `UserDevice_token_key` UNIQUE(`token`),
	CONSTRAINT `UserDevice_widgetToken_key` UNIQUE(`widgetToken`)
);

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

CREATE TABLE `UserPushPreference` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`category` enum('combat','recovery','training','war','clan','trade','social','system') NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `UserPushPreference_id` PRIMARY KEY(`id`),
	CONSTRAINT `UserPushPreference_userId_category_key` UNIQUE(`userId`,`category`)
);

CREATE INDEX `StorePurchase_userId_createdAt_idx` ON `StorePurchase` (`userId`,`createdAt`);
CREATE INDEX `UserDevice_userId_lastSeenAt_idx` ON `UserDevice` (`userId`,`lastSeenAt`);
CREATE INDEX `UserLiveActivity_activityId_idx` ON `UserLiveActivity` (`activityId`);
CREATE INDEX `UserLiveActivity_endsAt_idx` ON `UserLiveActivity` (`endsAt`);
CREATE INDEX `UserPushPreference_userId_idx` ON `UserPushPreference` (`userId`);