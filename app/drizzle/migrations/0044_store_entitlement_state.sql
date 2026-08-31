CREATE TABLE `StoreEntitlementState` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`store` enum('APPLE','GOOGLE') NOT NULL,
	`revokedThrough` datetime(3) NOT NULL,
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `StoreEntitlementState_id` PRIMARY KEY(`id`),
	CONSTRAINT `StoreEntitlementState_userId_store_key` UNIQUE(`userId`,`store`)
);
