CREATE TABLE `SkillTree` (
	`id` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL,
	`image` varchar(191) NOT NULL,
	`description` text NOT NULL,
	`effects` json NOT NULL,
	`tier` tinyint NOT NULL DEFAULT 1,
	`requiredSkillIds` json NOT NULL DEFAULT ('[]'),
	`costSkillPoints` int NOT NULL DEFAULT 1,
	`hidden` boolean NOT NULL DEFAULT false,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `SkillTree_id` PRIMARY KEY(`id`),
	CONSTRAINT `SkillTree_name_key` UNIQUE(`name`)
);

CREATE TABLE `UserSkill` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`skillId` varchar(191) NOT NULL,
	`purchasedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `UserSkill_id` PRIMARY KEY(`id`),
	CONSTRAINT `UserSkill_userId_skillId_key` UNIQUE(`userId`,`skillId`)
);

ALTER TABLE `UserData` ADD `skillPoints` int DEFAULT 0 NOT NULL;
CREATE INDEX `SkillTree_tier_idx` ON `SkillTree` (`tier`);
CREATE INDEX `SkillTree_hidden_idx` ON `SkillTree` (`hidden`);
CREATE INDEX `UserSkill_userId_idx` ON `UserSkill` (`userId`);
CREATE INDEX `UserSkill_skillId_idx` ON `UserSkill` (`skillId`);


UPDATE `UserData` SET `skillPoints` = LEAST(20, `level` - 20) WHERE `level` > 20;