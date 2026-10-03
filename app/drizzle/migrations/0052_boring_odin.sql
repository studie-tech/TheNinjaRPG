CREATE TABLE `StripeCheckout` (
	`closedAt` datetime(3),
	`id` varchar(191) NOT NULL,
	`sessionId` varchar(191),
	`createdById` varchar(191) NOT NULL,
	`affectedUserId` varchar(191) NOT NULL,
	`reputationPoints` int NOT NULL DEFAULT 0,
	`amountCents` int NOT NULL,
	`federalStatus` enum('NONE','NORMAL','SILVER','GOLD') NOT NULL DEFAULT 'NONE',
	`priceId` varchar(191),
	`subscriptionId` varchar(191),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `StripeCheckout_id` PRIMARY KEY(`id`),
	CONSTRAINT `StripeCheckout_sessionId_unique` UNIQUE(`sessionId`),
	CONSTRAINT `StripeCheckout_subscriptionId_unique` UNIQUE(`subscriptionId`)
);

CREATE TABLE `StripePayment` (
	`federalStatusOverride` enum('NONE','NORMAL','SILVER','GOLD'),
	`isSandbox` boolean NOT NULL DEFAULT false,
	`id` varchar(191) NOT NULL,
	`checkoutId` varchar(191) NOT NULL,
	`createdById` varchar(191) NOT NULL,
	`affectedUserId` varchar(191) NOT NULL,
	`amountCents` int NOT NULL,
	`reputationPoints` int NOT NULL DEFAULT 0,
	`federalStatus` enum('NONE','NORMAL','SILVER','GOLD') NOT NULL DEFAULT 'NONE',
	`purchasedAt` datetime(3) NOT NULL,
	`expiresAt` datetime(3),
	`grantedAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `StripePayment_id` PRIMARY KEY(`id`)
);

CREATE INDEX `StripeCheckout_createdById_idx` ON `StripeCheckout` (`createdById`);
CREATE INDEX `StripeCheckout_affectedUserId_idx` ON `StripeCheckout` (`affectedUserId`);
CREATE INDEX `StripePayment_createdById_idx` ON `StripePayment` (`createdById`);
CREATE INDEX `StripePayment_affectedUserId_idx` ON `StripePayment` (`affectedUserId`);
CREATE INDEX `StripePayment_checkoutId_idx` ON `StripePayment` (`checkoutId`);