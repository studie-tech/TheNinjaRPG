CREATE TABLE `AdClick` (
	`id` varchar(191) NOT NULL,
	`clickId` varchar(191) NOT NULL,
	`clickIdType` enum('gclid','gbraid','wbraid') NOT NULL,
	`ipHash` varchar(64) NOT NULL,
	`userId` varchar(191),
	`adUserDataConsent` enum('granted','unanswered') NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`registerReportedAt` datetime(3),
	`tutorialReportedAt` datetime(3),
	CONSTRAINT `AdClick_id` PRIMARY KEY(`id`),
	CONSTRAINT `AdClick_clickId_key` UNIQUE(`clickId`)
);

CREATE TABLE `AdConversionUpload` (
	`id` varchar(191) NOT NULL,
	`requestId` varchar(191) NOT NULL,
	`eventIndex` int NOT NULL,
	`adClickId` varchar(191) NOT NULL,
	`action` enum('register','tutorialComplete') NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `AdConversionUpload_id` PRIMARY KEY(`id`),
	CONSTRAINT `AdConversionUpload_adClickId_action_key` UNIQUE(`adClickId`,`action`)
);

CREATE INDEX `AdClick_ipHash_createdAt_idx` ON `AdClick` (`ipHash`,`createdAt`);
CREATE INDEX `AdClick_userId_idx` ON `AdClick` (`userId`);
CREATE INDEX `AdClick_createdAt_idx` ON `AdClick` (`createdAt`);
CREATE INDEX `AdConversionUpload_requestId_idx` ON `AdConversionUpload` (`requestId`);
CREATE INDEX `AdConversionUpload_createdAt_idx` ON `AdConversionUpload` (`createdAt`);