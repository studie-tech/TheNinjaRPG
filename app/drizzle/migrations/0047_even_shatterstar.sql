CREATE TABLE `StorePurchaseTransfer` (
	`id` varchar(191) NOT NULL,
	`sourceUserId` varchar(191) NOT NULL,
	`destinationUserId` varchar(191) NOT NULL,
	`store` enum('APPLE','GOOGLE') NOT NULL,
	`transferredAt` datetime(3) NOT NULL,
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `StorePurchaseTransfer_id` PRIMARY KEY(`id`),
	CONSTRAINT `StorePurchaseTransfer_sourceUserId_store_transferredAt_key` UNIQUE(`sourceUserId`,`store`,`transferredAt`)
);

CREATE INDEX `StorePurchaseTransfer_destinationUserId_idx` ON `StorePurchaseTransfer` (`destinationUserId`);
