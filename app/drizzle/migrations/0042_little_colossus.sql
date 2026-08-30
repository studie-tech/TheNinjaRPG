CREATE TABLE `StorePurchase` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`transactionId` varchar(191) NOT NULL,
	`productId` varchar(191) NOT NULL,
	`store` enum('APPLE','GOOGLE') NOT NULL,
	`reputationPoints` int NOT NULL DEFAULT 0,
	`federalStatus` enum('NONE','NORMAL','SILVER','GOLD'),
	`isSandbox` boolean NOT NULL DEFAULT false,
	`rawData` json NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `StorePurchase_id` PRIMARY KEY(`id`),
	CONSTRAINT `StorePurchase_transactionId_key` UNIQUE(`transactionId`)
);

CREATE INDEX `StorePurchase_userId_idx` ON `StorePurchase` (`userId`);
CREATE INDEX `StorePurchase_createdAt_idx` ON `StorePurchase` (`createdAt`);