CREATE TABLE `ChakraStormClaimReceipt` (
	`id` varchar(191) NOT NULL,
	`claimKey` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`stage` varchar(32) NOT NULL,
	`seconds` int NOT NULL,
	`kills` int NOT NULL,
	`level` int NOT NULL,
	`won` boolean NOT NULL,
	`intelEarned` int NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `ChakraStormClaimReceipt_id` PRIMARY KEY(`id`),
	CONSTRAINT `ChakraStormClaimReceipt_claimKey_key` UNIQUE(`claimKey`)
);

CREATE TABLE `ChakraStormProgress` (
	`userId` varchar(191) NOT NULL,
	`intel` int NOT NULL DEFAULT 0,
	`training` json NOT NULL,
	`stages` json NOT NULL,
	`activeRun` varchar(21),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `ChakraStormProgress_userId` PRIMARY KEY(`userId`)
);

ALTER TABLE `UserData` ADD `chakraStormDutyAt` datetime(3);
CREATE INDEX `ChakraStormClaimReceipt_userId_idx` ON `ChakraStormClaimReceipt` (`userId`);