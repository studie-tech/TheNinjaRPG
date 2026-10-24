CREATE TABLE `DiscordLink` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`discordId` varchar(32) NOT NULL,
	`discordUsername` varchar(191) NOT NULL,
	`discordCreatedAt` datetime(3) NOT NULL,
	`clerkDiscordId` varchar(32),
	`linkedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`accessToken` text NOT NULL,
	`refreshToken` text NOT NULL,
	`tokenExpiresAt` datetime(3) NOT NULL,
	`scopes` varchar(191) NOT NULL,
	`syncedAt` datetime(3),
	`syncedUsername` varchar(191),
	`syncedVillageId` varchar(191),
	`syncedLevel` int,
	`syncedBanned` boolean NOT NULL DEFAULT false,
	`syncError` varchar(500),
	CONSTRAINT `DiscordLink_id` PRIMARY KEY(`id`),
	CONSTRAINT `DiscordLink_userId_key` UNIQUE(`userId`),
	CONSTRAINT `DiscordLink_discordId_key` UNIQUE(`discordId`)
);

CREATE TABLE `DiscordLinkHistory` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`discordId` varchar(32) NOT NULL,
	`discordUsername` varchar(191) NOT NULL,
	`linkedAt` datetime(3) NOT NULL,
	`unlinkedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`reason` enum('USER','STAFF','ACCOUNT_DELETED') NOT NULL,
	`unlinkedByUserId` varchar(191),
	`cooldownWaived` boolean NOT NULL DEFAULT false,
	CONSTRAINT `DiscordLinkHistory_id` PRIMARY KEY(`id`)
);

CREATE INDEX `DiscordLink_clerkDiscordId_idx` ON `DiscordLink` (`clerkDiscordId`);
CREATE INDEX `DiscordLink_syncedAt_idx` ON `DiscordLink` (`syncedAt`);
CREATE INDEX `DiscordLinkHistory_userId_unlinkedAt_idx` ON `DiscordLinkHistory` (`userId`,`unlinkedAt`);
CREATE INDEX `DiscordLinkHistory_discordId_unlinkedAt_idx` ON `DiscordLinkHistory` (`discordId`,`unlinkedAt`);