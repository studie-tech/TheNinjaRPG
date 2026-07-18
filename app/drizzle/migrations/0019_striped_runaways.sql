CREATE TABLE `SageMode` (
	`id` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL,
	`image` varchar(191) NOT NULL,
	`description` text NOT NULL,
	`battleDescription` text,
	`effects` json NOT NULL DEFAULT ('[]'),
	`afterEffects` json NOT NULL DEFAULT ('[]'),
	`level2Effects` json NOT NULL DEFAULT ('[]'),
	`activationRounds` tinyint NOT NULL DEFAULT 5,
	`afterEffectRounds` tinyint NOT NULL DEFAULT 3,
	`chakraCostPerc` tinyint NOT NULL DEFAULT 20,
	`staminaCostPerc` tinyint NOT NULL DEFAULT 20,
	`actionCostPerc` tinyint NOT NULL DEFAULT 80,
	`level` tinyint NOT NULL DEFAULT 1,
	`requiredSageMastery` int NOT NULL DEFAULT 0,
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
	`type` enum('ITEM','QUEST') NOT NULL,
	CONSTRAINT `SageModeRolls_id` PRIMARY KEY(`id`)
);

ALTER TABLE `BloodlineRolls` MODIFY COLUMN `pityRolls` smallint NOT NULL DEFAULT 0;
ALTER TABLE `Quest` ADD `requiredSageModeId` varchar(191);
ALTER TABLE `Quest` ADD `requiredSageRank` enum('NONE','INITIATE','ADEPT','MASTER','LEGENDARY');
ALTER TABLE `UserData` ADD `sageModeId` varchar(191);
ALTER TABLE `UserData` ADD `sageMasteryExperience` int DEFAULT 0 NOT NULL;
ALTER TABLE `UserData` ADD `dailySageActivations` smallint unsigned DEFAULT 0 NOT NULL;
CREATE INDEX `SageMode_level_idx` ON `SageMode` (`level`);
CREATE INDEX `SageMode_villageId_idx` ON `SageMode` (`villageId`);
CREATE INDEX `SageMode_hidden_idx` ON `SageMode` (`hidden`);
CREATE INDEX `SageModeRolls_userId_idx` ON `SageModeRolls` (`userId`);
CREATE INDEX `SageModeRolls_sageModeId_idx` ON `SageModeRolls` (`sageModeId`);
CREATE INDEX `Quest_requiredSageMode_idx` ON `Quest` (`requiredSageModeId`);
CREATE INDEX `UserData_sageModeId_idx` ON `UserData` (`sageModeId`);