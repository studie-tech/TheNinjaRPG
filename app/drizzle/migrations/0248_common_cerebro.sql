CREATE TABLE `CraftingRequirement` (
	`id` varchar(191) NOT NULL,
	`craftItemId` varchar(191) NOT NULL,
	`requirementItemId` varchar(191) NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `CraftingRequirement_id` PRIMARY KEY(`id`)
);

CREATE TABLE `UserItemImbuement` (
	`id` varchar(191) NOT NULL,
	`userItemId` varchar(191) NOT NULL,
	`imbuementItemId` varchar(191) NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`craftingFinishedAt` datetime(3) NOT NULL,
	CONSTRAINT `UserItemImbuement_id` PRIMARY KEY(`id`)
);

ALTER TABLE `Item` MODIFY COLUMN `itemType` enum('WEAPON','CONSUMABLE','ARMOR','ACCESSORY','MATERIAL','KEYSTONE','CRYSTAL','OTHER') NOT NULL;
ALTER TABLE `Item` ADD `craftable` boolean DEFAULT false NOT NULL;
ALTER TABLE `Item` ADD `canBeImbued` boolean DEFAULT false NOT NULL;
ALTER TABLE `UserData` ADD `craftingExperience` int DEFAULT 0 NOT NULL;
ALTER TABLE `UserItem` ADD `craftingFinishedAt` datetime(3);
CREATE INDEX `CraftingRequirement_craftItemId_idx` ON `CraftingRequirement` (`craftItemId`);
CREATE INDEX `CraftingRequirement_requirementItemId_idx` ON `CraftingRequirement` (`requirementItemId`);