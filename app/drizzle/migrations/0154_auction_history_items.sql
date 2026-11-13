ALTER TABLE `AuctionListing` ADD `itemId` varchar(191) NOT NULL;
ALTER TABLE `AuctionListing` ADD `quantity` int unsigned NOT NULL;
ALTER TABLE `AuctionOffer` ADD `offeredItemId` varchar(191);

-- Existing listings take the item and quantity logged when they were created; the log holds
-- them as a JSON object or as JSON text. Listings logged without a quantity take what their
-- stack holds now; a stack in the middle of a merge holds its quantity negated.
UPDATE `AuctionListing`
LEFT JOIN (
  SELECT `relatedId`, CASE
    WHEN JSON_TYPE(`changes`) = 'OBJECT' THEN `changes`
    WHEN JSON_TYPE(`changes`) = 'STRING' AND JSON_VALID(`changes`->>'$')
      THEN CAST(`changes`->>'$' AS JSON)
  END AS `created`
  FROM `ActionLog`
  WHERE `tableName` = 'auctionListing' AND `changes` LIKE '%CREATE\_AUCTION%'
) AS `listingLog` ON `listingLog`.`relatedId` = `AuctionListing`.`id`
  AND `listingLog`.`created`->>'$.action' = 'CREATE_AUCTION'
LEFT JOIN `UserItem` ON `UserItem`.`id` = `AuctionListing`.`userItemId`
SET `AuctionListing`.`itemId` = COALESCE(
    `listingLog`.`created`->>'$.itemId',
    `UserItem`.`itemId`,
    ''
  ),
  `AuctionListing`.`quantity` = COALESCE(
    CAST(`listingLog`.`created`->>'$.quantity' AS UNSIGNED),
    ABS(`UserItem`.`quantity`),
    0
  );
-- Trade offers take the item their stack holds.
UPDATE `AuctionOffer`
INNER JOIN `UserItem` ON `UserItem`.`id` = `AuctionOffer`.`offeredUserItemId`
SET `AuctionOffer`.`offeredItemId` = `UserItem`.`itemId`;
