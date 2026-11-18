CREATE TABLE `MetaConsent` (
	`id` varchar(36) NOT NULL,
	`userId` varchar(191),
	`granted` boolean NOT NULL,
	`revision` int NOT NULL,
	`decidedAt` datetime(3) NOT NULL,
	`expiresAt` datetime(3) NOT NULL,
	CONSTRAINT `MetaConsent_id` PRIMARY KEY(`id`)
);

CREATE TABLE `MetaTracking` (
	`userId` varchar(191) NOT NULL,
	`consentId` varchar(36) NOT NULL,
	`decidedAt` datetime(3) NOT NULL,
	`expiresAt` datetime(3) NOT NULL,
	`fbc` varchar(512),
	`fbp` varchar(128),
	`userAgent` varchar(1024) NOT NULL,
	`registrationAt` datetime(3),
	`registrationEventId` varchar(36) NOT NULL,
	`tutorialEventId` varchar(36) NOT NULL,
	`registrationReportedAt` datetime(3),
	`tutorialReportedAt` datetime(3),
	`tutorialUserAgent` varchar(1024),
	CONSTRAINT `MetaTracking_userId` PRIMARY KEY(`userId`)
);

CREATE INDEX `MetaConsent_userId_idx` ON `MetaConsent` (`userId`);
CREATE INDEX `MetaConsent_expiresAt_idx` ON `MetaConsent` (`expiresAt`);
CREATE INDEX `MetaTracking_consentId_idx` ON `MetaTracking` (`consentId`);
CREATE INDEX `MetaTracking_expiresAt_idx` ON `MetaTracking` (`expiresAt`);