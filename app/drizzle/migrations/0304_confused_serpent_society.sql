ALTER TABLE `AuctionListing` ADD `currencyType` enum('MONEY','REPUTATION') DEFAULT 'MONEY' NOT NULL;
ALTER TABLE `UserRequest` ADD `spectatable` boolean DEFAULT false;
