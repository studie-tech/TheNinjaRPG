CREATE TABLE `StoreEntitlementRevocation` (
	`id` varchar(191) NOT NULL,
	`eventId` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`store` enum('APPLE','GOOGLE') NOT NULL,
	`productId` varchar(191),
	`transactionId` varchar(191),
	`revokedThrough` datetime(3) NOT NULL,
	`occurredAt` datetime(3) NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `StoreEntitlementRevocation_id` PRIMARY KEY(`id`),
	CONSTRAINT `StoreEntitlementRevocation_eventId_userId_store_key` UNIQUE(`eventId`,`userId`,`store`)
);

CREATE INDEX `StoreEntitlementRevocation_userId_store_revokedThrough_idx` ON `StoreEntitlementRevocation` (`userId`,`store`,`revokedThrough`);