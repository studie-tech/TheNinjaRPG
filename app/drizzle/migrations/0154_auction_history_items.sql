ALTER TABLE `AuctionListing` ADD `itemId` varchar(191) DEFAULT '' NOT NULL;
ALTER TABLE `AuctionListing` ADD `quantity` int unsigned DEFAULT 0 NOT NULL;
ALTER TABLE `AuctionOffer` ADD `offeredItemId` varchar(191);
-- The fills below touch only rows still empty, so running them again after the deploy also
-- fills listings and trade offers that the previous build created in between.
-- Listings take the item and quantity logged when they were created; the log holds them as a
-- JSON object or as JSON text. Listings logged without a usable item or quantity take what
-- their stack holds now. A quantity read while its stack was in the middle of a merge is negated.
UPDATE `AuctionListing`
LEFT JOIN (
  SELECT `relatedId`, CASE
    WHEN JSON_TYPE(`changes`) = 'OBJECT' THEN `changes`
    WHEN JSON_TYPE(`changes`) = 'STRING' AND JSON_VALID(`changes`->>'$')
      THEN CAST(`changes`->>'$' AS JSON)
  END AS `created`
  FROM `ActionLog`
  WHERE `tableName` = 'auctionListing' AND `changes` LIKE '%CREATE_AUCTION%'
) AS `listingLog` ON `listingLog`.`relatedId` = `AuctionListing`.`id`
  AND `listingLog`.`created`->>'$.action' = 'CREATE_AUCTION'
LEFT JOIN `UserItem` ON `UserItem`.`id` = `AuctionListing`.`userItemId`
SET `AuctionListing`.`itemId` = COALESCE(
    CASE WHEN JSON_TYPE(`listingLog`.`created`->'$.itemId') = 'STRING'
      THEN `listingLog`.`created`->>'$.itemId' END,
    `UserItem`.`itemId`,
    ''
  ),
  `AuctionListing`.`quantity` = COALESCE(
    CASE WHEN `listingLog`.`created`->>'$.quantity' REGEXP '^-?[0-9]{1,9}$'
      THEN ABS(CAST(`listingLog`.`created`->>'$.quantity' AS SIGNED)) END,
    ABS(`UserItem`.`quantity`),
    0
  )
WHERE `AuctionListing`.`itemId` = '';
-- Trade offers take the item their stack holds.
UPDATE `AuctionOffer`
INNER JOIN `UserItem` ON `UserItem`.`id` = `AuctionOffer`.`offeredUserItemId`
SET `AuctionOffer`.`offeredItemId` = `UserItem`.`itemId`
WHERE `AuctionOffer`.`offeredItemId` IS NULL;
