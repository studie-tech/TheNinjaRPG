CREATE TABLE `SplashAnnouncement` (
	`id` varchar(191) NOT NULL,
	`topicKey` varchar(100) NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text NOT NULL,
	`image` varchar(1000) NOT NULL DEFAULT '',
	`href` varchar(300) NOT NULL,
	`linkLabel` varchar(60) NOT NULL,
	`priority` int NOT NULL DEFAULT 0,
	`enabled` boolean NOT NULL DEFAULT false,
	`startsAt` datetime(3),
	`endsAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `SplashAnnouncement_id` PRIMARY KEY(`id`),
	CONSTRAINT `SplashAnnouncement_topicKey_key` UNIQUE(`topicKey`)
);

ALTER TABLE `ContentProposalBasis` MODIFY COLUMN `entityType` enum('JUTSU','ITEM','BLOODLINE','QUEST','BADGE','TITLE','GAME_ASSET','AI','SPLASH') NOT NULL;
ALTER TABLE `ContentProposalChange` MODIFY COLUMN `entityType` enum('JUTSU','ITEM','BLOODLINE','QUEST','BADGE','TITLE','GAME_ASSET','AI','SPLASH') NOT NULL;
CREATE INDEX `SplashAnnouncement_enabled_priority_idx` ON `SplashAnnouncement` (`enabled`,`priority`);
CREATE INDEX `WebStoreOrder_recipient_bundle_idx` ON `WebStoreOrder` (`recipientId`,`bundleId`);
INSERT INTO `SplashAnnouncement` (`id`, `topicKey`, `name`, `description`, `image`, `href`, `linkLabel`, `priority`, `enabled`) VALUES
('welcome-tower-defense', 'tower-defense', 'Defend the village', 'Face waves of raiders in Tower Defense. Build your defenses and train in the Guard Hall between runs.', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ2HMAwecnMXlcRpYmJ5do0zKw4Qx6PVEtBa9b.webp', '/towerDefense', 'Play Tower Defense', 10, true),
('welcome-market', 'market-bundle-gifts', 'Visit the Market', 'Browse reputation packs and bundles. Send a bundle to another player with Gift bundle; account limits apply to the recipient.', 'https://uploadthing.b-cdn.net/f/orgABef23sCbtFgzqE1ZY.webp', '/points', 'Explore the Market', 0, true);
