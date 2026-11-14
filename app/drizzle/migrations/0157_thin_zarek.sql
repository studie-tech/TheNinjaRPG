CREATE TABLE `UserCosmetic` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`itemId` varchar(191) NOT NULL,
	CONSTRAINT `UserCosmetic_id` PRIMARY KEY(`id`),
	CONSTRAINT `UserCosmetic_user_item_key` UNIQUE(`userId`,`itemId`)
);

CREATE TABLE `UserCosmeticSlot` (
	`userId` varchar(191) NOT NULL,
	`slot` enum('HEAD','CHEST','LEGS','FEET','HAND_1','HAND_2','THROWN','WAIST','KEYSTONE','ITEM_1','ITEM_2','ITEM_3','ITEM_4','ITEM_5','ITEM_6','NONE') NOT NULL,
	`itemId` varchar(191) NOT NULL,
	`variantId` varchar(191),
	CONSTRAINT `UserCosmeticSlot_userId_slot_pk` PRIMARY KEY(`userId`,`slot`)
);

CREATE INDEX `UserCosmetic_item_idx` ON `UserCosmetic` (`itemId`);
CREATE INDEX `UserCosmeticSlot_item_idx` ON `UserCosmeticSlot` (`itemId`);
CREATE INDEX `UserCosmeticSlot_variant_idx` ON `UserCosmeticSlot` (`variantId`);