ALTER TABLE `AuctionListing` ADD `bidderMinLevel` int DEFAULT 1 NOT NULL;
ALTER TABLE `AuctionListing` ADD `bidderMaxLevel` int DEFAULT 100 NOT NULL;
CREATE INDEX `AuctionListing_status_listingType_bidderLevels_idx` ON `AuctionListing` (`status`,`listingType`,`bidderMinLevel`,`bidderMaxLevel`);