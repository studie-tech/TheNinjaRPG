CREATE TABLE `SageMode` (
	`id` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL,
	`image` varchar(191) NOT NULL,
	`description` text NOT NULL,
	`effects` json NOT NULL DEFAULT ('[]'),
	`afterEffects` json NOT NULL DEFAULT ('[]'),
	`activationRounds` tinyint NOT NULL DEFAULT 5,
	`afterEffectRounds` tinyint NOT NULL DEFAULT 3,
	`chakraCostPerc` tinyint NOT NULL DEFAULT 20,
	`staminaCostPerc` tinyint NOT NULL DEFAULT 20,
	`level` tinyint NOT NULL DEFAULT 1,
	`requiredSageMastery` int NOT NULL DEFAULT 0,
	`rank` enum('D','C','B','A','S','H') NOT NULL,
	`hidden` boolean NOT NULL DEFAULT false,
	`villageId` varchar(191),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `SageMode_id` PRIMARY KEY(`id`),
	CONSTRAINT `SageMode_name_key` UNIQUE(`name`)
);

CREATE TABLE `SageModeRolls` (
	`id` varchar(191) NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`userId` varchar(191) NOT NULL,
	`sageModeId` varchar(191),
	`used` smallint NOT NULL DEFAULT 0,
	`pityRolls` smallint NOT NULL DEFAULT 0,
	`type` enum('NATURAL','ITEM','PITY','DIRECT','QUEST') NOT NULL DEFAULT 'NATURAL',
	`rank` enum('D','C','B','A','S','H'),
	CONSTRAINT `SageModeRolls_id` PRIMARY KEY(`id`)
);

ALTER TABLE `BloodlineRolls` MODIFY COLUMN `pityRolls` smallint NOT NULL DEFAULT 0;
ALTER TABLE `UserData` ADD `sageModeId` varchar(191);
ALTER TABLE `UserData` ADD `sageMasteryExperience` int DEFAULT 0 NOT NULL;
CREATE INDEX `SageMode_level_idx` ON `SageMode` (`level`);
CREATE INDEX `SageMode_rank_idx` ON `SageMode` (`rank`);
CREATE INDEX `SageMode_villageId_idx` ON `SageMode` (`villageId`);
CREATE INDEX `SageMode_hidden_idx` ON `SageMode` (`hidden`);
CREATE INDEX `SageModeRolls_userId_idx` ON `SageModeRolls` (`userId`);
CREATE INDEX `SageModeRolls_sageModeId_idx` ON `SageModeRolls` (`sageModeId`);
CREATE INDEX `UserData_sageModeId_idx` ON `UserData` (`sageModeId`);