CREATE TABLE `CraftingServicePrice` (
	`revision` int unsigned NOT NULL DEFAULT 0,
	`userId` varchar(191) NOT NULL,
	`service` enum('CRAFT','IMBUE','DISIMBUE','REPAIR') NOT NULL,
	`rarity` enum('COMMON','RARE','EPIC','LEGENDARY') NOT NULL,
	`fee` int unsigned NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	CONSTRAINT `CraftingServicePrice_userId_service_rarity_pk` PRIMARY KEY(`userId`,`service`,`rarity`)
);

CREATE TABLE `CraftingServiceRequest` (
	`id` varchar(191) NOT NULL,
	`requesterId` varchar(191) NOT NULL,
	`crafterId` varchar(191) NOT NULL,
	`service` enum('CRAFT','IMBUE','DISIMBUE','REPAIR') NOT NULL,
	`status` enum('PENDING','ACTIVE','COMPLETED','REFUNDED') NOT NULL DEFAULT 'PENDING',
	`fee` int unsigned NOT NULL,
	`itemId` varchar(191) NOT NULL,
	`itemName` varchar(191) NOT NULL,
	`targetUserItemId` varchar(191),
	`crystalItemId` varchar(191),
	`imbuementId` varchar(191),
	`materials` json NOT NULL,
	`repairDurability` int unsigned,
	`outputQuantity` int unsigned NOT NULL DEFAULT 1,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`startedAt` datetime(3),
	`finishesAt` datetime(3),
	CONSTRAINT `CraftingServiceRequest_id` PRIMARY KEY(`id`)
);

ALTER TABLE `UserData` ADD `serviceCraftUntil` datetime(3);
CREATE INDEX `CraftingServiceRequest_crafter_status_idx` ON `CraftingServiceRequest` (`crafterId`,`status`);
CREATE INDEX `CraftingServiceRequest_requester_status_idx` ON `CraftingServiceRequest` (`requesterId`,`status`);