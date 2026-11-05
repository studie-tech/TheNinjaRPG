CREATE TABLE `AiSpriteAnimation` (
	`userId` varchar(191) NOT NULL,
	`actionKey` varchar(191) NOT NULL,
	`animationId` varchar(191) NOT NULL,
	CONSTRAINT `AiSpriteAnimation_userId_actionKey_pk` PRIMARY KEY(`userId`,`actionKey`)
);

CREATE TABLE `SpriteAnimation` (
	`id` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL,
	`url` varchar(2048) NOT NULL,
	`columns` smallint NOT NULL,
	`rows` smallint NOT NULL,
	`frameCount` smallint NOT NULL,
	`fps` float NOT NULL,
	`facing` enum('left','right') NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`createdByUserId` varchar(191) NOT NULL,
	CONSTRAINT `SpriteAnimation_id` PRIMARY KEY(`id`)
);

CREATE INDEX `AiSpriteAnimation_animation_idx` ON `AiSpriteAnimation` (`animationId`);