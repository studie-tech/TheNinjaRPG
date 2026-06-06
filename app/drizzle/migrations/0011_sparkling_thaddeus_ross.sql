CREATE TABLE `ItemVariant` (
	`id` varchar(191) NOT NULL,
	`itemId` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL,
	`image` varchar(512) NOT NULL,
	`costType` enum('MONEY','REPUTATION','SEICHI_SILVER','VILLAGE_PRESTIGE','VARIANT_TOKEN') NOT NULL,
	`cost` int NOT NULL DEFAULT 0,
	`order` smallint unsigned NOT NULL DEFAULT 1,
	`description` text,
	`battleDescription` text,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `ItemVariant_id` PRIMARY KEY(`id`),
	CONSTRAINT `ItemVariant_itemId_order_key` UNIQUE(`itemId`,`order`)
);

CREATE TABLE `UserItemVariant` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`variantId` varchar(191) NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `UserItemVariant_id` PRIMARY KEY(`id`),
	CONSTRAINT `UserItemVariant_userId_variantId_key` UNIQUE(`userId`,`variantId`)
);

ALTER TABLE `UserItem` ADD `activeVariantId` varchar(191);
CREATE INDEX `ItemVariant_itemId_idx` ON `ItemVariant` (`itemId`);
CREATE INDEX `UserItemVariant_userId_idx` ON `UserItemVariant` (`userId`);
CREATE INDEX `UserItemVariant_variantId_idx` ON `UserItemVariant` (`variantId`);
CREATE INDEX `UserItem_activeVariantId_idx` ON `UserItem` (`activeVariantId`);