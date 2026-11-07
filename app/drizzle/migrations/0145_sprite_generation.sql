CREATE TABLE `SpriteGeneration` (
	`id` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL,
	`prompt` varchar(2000) NOT NULL,
	`motion` enum('idle','move','custom') NOT NULL,
	`frames` smallint NOT NULL,
	`facing` enum('left','right') NOT NULL,
	`sourceUrl` varchar(2048) NOT NULL,
	`remoteImageId` varchar(191) NOT NULL,
	`remoteAssetId` varchar(191) NOT NULL,
	`aiUserId` varchar(191),
	`actionKey` varchar(191),
	`status` enum('QUEUED','PROCESSING','PREPARING','READY','ACCEPTED','DISCARDED','FAILED') NOT NULL DEFAULT 'QUEUED',
	`stage` varchar(191),
	`error` varchar(500),
	`url` varchar(2048),
	`smallUrl` varchar(2048),
	`columns` smallint,
	`rows` smallint,
	`frameCount` smallint,
	`fps` float,
	`animationId` varchar(191),
	`createdByUserId` varchar(191) NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `SpriteGeneration_id` PRIMARY KEY(`id`),
	CONSTRAINT `SpriteGeneration_remoteAssetId_key` UNIQUE(`remoteAssetId`)
);

CREATE INDEX `SpriteGeneration_status_idx` ON `SpriteGeneration` (`status`);
CREATE INDEX `SpriteGeneration_createdAt_idx` ON `SpriteGeneration` (`createdAt`);