ALTER TABLE `AuctionListing` ADD `itemId` varchar(191) NOT NULL;
ALTER TABLE `AuctionListing` ADD `quantity` int unsigned NOT NULL;
ALTER TABLE `AuctionOffer` ADD `offeredItemId` varchar(191);

-- Existing listings and trade offers take the item and quantity their stack holds now;
-- a stack in the middle of a merge holds its quantity negated.
UPDATE `AuctionListing`
INNER JOIN `UserItem` ON `UserItem`.`id` = `AuctionListing`.`userItemId`
SET `AuctionListing`.`itemId` = `UserItem`.`itemId`,
  `AuctionListing`.`quantity` = ABS(`UserItem`.`quantity`);
UPDATE `AuctionOffer`
INNER JOIN `UserItem` ON `UserItem`.`id` = `AuctionOffer`.`offeredUserItemId`
SET `AuctionOffer`.`offeredItemId` = `UserItem`.`itemId`;
