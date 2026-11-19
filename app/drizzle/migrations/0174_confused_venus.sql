CREATE TABLE `SplashAnnouncement` (
	`id` varchar(191) NOT NULL,
	`content` json NOT NULL,
	CONSTRAINT `SplashAnnouncement_id` PRIMARY KEY(`id`)
);

ALTER TABLE `ContentProposalBasis` MODIFY COLUMN `entityType` enum('JUTSU','ITEM','BLOODLINE','QUEST','BADGE','TITLE','GAME_ASSET','AI','SPLASH') NOT NULL;
ALTER TABLE `ContentProposalChange` MODIFY COLUMN `entityType` enum('JUTSU','ITEM','BLOODLINE','QUEST','BADGE','TITLE','GAME_ASSET','AI','SPLASH') NOT NULL;
CREATE INDEX `WebStoreOrder_recipient_bundle_idx` ON `WebStoreOrder` (`recipientId`,`bundleId`);