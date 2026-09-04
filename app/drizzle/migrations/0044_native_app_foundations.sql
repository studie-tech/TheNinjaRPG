CREATE TABLE `StoreEntitlementRevocation` (
	`id` varchar(191) NOT NULL,
	`eventId` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`store` enum('APPLE','GOOGLE') NOT NULL,
	`isSandbox` boolean NOT NULL DEFAULT false,
	`productId` varchar(191),
	`transactionId` varchar(191),
	`revokedThrough` datetime(3) NOT NULL,
	`occurredAt` datetime(3) NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `StoreEntitlementRevocation_id` PRIMARY KEY(`id`),
	CONSTRAINT `StoreEntitlementRevocation_eventId_userId_store_isSandbox_key` UNIQUE(`eventId`,`userId`,`store`,`isSandbox`)
);

CREATE TABLE `StoreEntitlementState` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`store` enum('APPLE','GOOGLE') NOT NULL,
	`isSandbox` boolean NOT NULL DEFAULT false,
	`revokedThrough` datetime(3) NOT NULL,
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `StoreEntitlementState_id` PRIMARY KEY(`id`),
	CONSTRAINT `StoreEntitlementState_userId_store_isSandbox_key` UNIQUE(`userId`,`store`,`isSandbox`)
);

CREATE TABLE `StorePurchase` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`originalUserId` varchar(191) NOT NULL,
	`transactionId` varchar(191) NOT NULL,
	`productId` varchar(191) NOT NULL,
	`store` enum('APPLE','GOOGLE') NOT NULL,
	`reputationPoints` int NOT NULL DEFAULT 0,
	`federalStatus` enum('NONE','NORMAL','SILVER','GOLD'),
	`isSandbox` boolean NOT NULL DEFAULT false,
	`acceptedAt` datetime(3),
	`grantedAt` datetime(3),
	`purchasedAt` datetime(3) NOT NULL,
	`expiresAt` datetime(3),
	`revokedAt` datetime(3),
	`rawData` json NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `StorePurchase_id` PRIMARY KEY(`id`),
	CONSTRAINT `StorePurchase_transactionId_key` UNIQUE(`transactionId`)
);

CREATE TABLE `StorePurchaseTransfer` (
	`id` varchar(191) NOT NULL,
	`eventId` varchar(191) NOT NULL,
	`sourceUserId` varchar(191) NOT NULL,
	`destinationUserId` varchar(191) NOT NULL,
	`store` enum('APPLE','GOOGLE') NOT NULL,
	`isSandbox` boolean NOT NULL DEFAULT false,
	`transferredAt` datetime(3) NOT NULL,
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `StorePurchaseTransfer_id` PRIMARY KEY(`id`),
	CONSTRAINT `StorePurchaseTransfer_eventId_sourceUserId_store_isSandbox_key` UNIQUE(`eventId`,`sourceUserId`,`store`,`isSandbox`)
);

CREATE TABLE `StoreUserIdAlias` (
	`oldUserId` varchar(191) NOT NULL,
	`newUserId` varchar(191) NOT NULL,
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `StoreUserIdAlias_oldUserId` PRIMARY KEY(`oldUserId`)
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
	CONSTRAINT `UserLiveActivity_userId_activityId_key` UNIQUE(`userId`,`activityId`)
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

CREATE INDEX `StoreEntitlementRevocation_owner_env_cutoff_idx` ON `StoreEntitlementRevocation` (`userId`,`store`,`isSandbox`,`revokedThrough`);
CREATE INDEX `StorePurchase_userId_createdAt_idx` ON `StorePurchase` (`userId`,`createdAt`);
CREATE INDEX `StorePurchase_userId_purchasedAt_idx` ON `StorePurchase` (`userId`,`purchasedAt`);
CREATE INDEX `StorePurchase_originalUserId_store_idx` ON `StorePurchase` (`originalUserId`,`store`);
CREATE INDEX `StorePurchaseTransfer_source_env_time_idx` ON `StorePurchaseTransfer` (`sourceUserId`,`store`,`isSandbox`,`transferredAt`);
CREATE INDEX `StorePurchaseTransfer_destinationUserId_store_isSandbox_idx` ON `StorePurchaseTransfer` (`destinationUserId`,`store`,`isSandbox`);
CREATE INDEX `UserDevice_userId_lastSeenAt_idx` ON `UserDevice` (`userId`,`lastSeenAt`);
CREATE INDEX `UserLiveActivity_userId_kind_idx` ON `UserLiveActivity` (`userId`,`kind`);
CREATE INDEX `UserLiveActivity_endsAt_idx` ON `UserLiveActivity` (`endsAt`);
CREATE INDEX `UserPushPreference_userId_idx` ON `UserPushPreference` (`userId`);