CREATE TABLE `AuctionBid` (
	`id` varchar(191) NOT NULL,
	`auctionId` varchar(191) NOT NULL,
	`bidderId` varchar(191) NOT NULL,
	`amount` double NOT NULL,
	`status` enum('ACTIVE','REFUNDED','WON') NOT NULL DEFAULT 'ACTIVE',
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `AuctionBid_id` PRIMARY KEY(`id`)
);

CREATE TABLE `AuctionListing` (
	`id` varchar(191) NOT NULL,
	`sellerId` varchar(191) NOT NULL,
	`buyerId` varchar(191),
	`userItemId` varchar(191) NOT NULL,
	`listingType` enum('AUCTION','DIRECT') NOT NULL,
	`targetUserId` varchar(191),
	`startingPrice` double NOT NULL,
	`buyoutPrice` double,
	`currentPrice` double NOT NULL,
	`expiresAt` datetime(3) NOT NULL,
	`status` enum('ACTIVE','SOLD','EXPIRED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `AuctionListing_id` PRIMARY KEY(`id`)
);

ALTER TABLE `Item` ADD `canBeTraded` boolean DEFAULT false NOT NULL;
ALTER TABLE `UserItem` ADD `isInAuction` boolean DEFAULT false NOT NULL;
CREATE INDEX `AuctionBid_auctionId_idx` ON `AuctionBid` (`auctionId`);
CREATE INDEX `AuctionBid_bidderId_idx` ON `AuctionBid` (`bidderId`);
CREATE INDEX `AuctionBid_amount_idx` ON `AuctionBid` (`amount`);
CREATE INDEX `AuctionListing_sellerId_idx` ON `AuctionListing` (`sellerId`);
CREATE INDEX `AuctionListing_buyerId_idx` ON `AuctionListing` (`buyerId`);
CREATE INDEX `AuctionListing_userItemId_idx` ON `AuctionListing` (`userItemId`);
CREATE INDEX `AuctionListing_targetUserId_idx` ON `AuctionListing` (`targetUserId`);
CREATE INDEX `AuctionListing_status_idx` ON `AuctionListing` (`status`);
CREATE INDEX `AuctionListing_expiresAt_idx` ON `AuctionListing` (`expiresAt`);


-- Add Auction House building to Wake Island
INSERT INTO `VillageStructure` (`id`, `name`, `image`, `villageId`, `level`, `maxLevel`, `curSp`, `maxSp`, `longitude`, `latitude`, `hasPage`, `anbuSquadsPerLvl`, `arenaRewardPerLvl`, `bankInterestPerLvl`, `blackDiscountPerLvl`, `clansPerLvl`, `hospitalSpeedupPerLvl`, `itemDiscountPerLvl`, `ramenDiscountPerLvl`, `regenIncreasePerLvl`, `sleepRegenPerLvl`, `structureDiscountPerLvl`, `trainBoostPerLvl`, `villageDefencePerLvl`, `patrolsPerLvl`, `baseCost`, `allyAccess`, `route`, `lastUpgradedAt`)
VALUES
	('AuctionHouse_WakeIsland', 'Auction House', 'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJmcDNSqHE4IMO5Goa7cgLxPJ0VC6lU8vbt1Ap', '1nSqxViGqnXp_xXAPeQMC', 1, 10, 5000, 5000, 1, 9, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10000, 1, '/auctionhouse', NULL);