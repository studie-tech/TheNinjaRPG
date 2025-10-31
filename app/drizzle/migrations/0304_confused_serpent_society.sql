ALTER TABLE `Item` MODIFY COLUMN `crystalTargetTypes` enum('WEAPON','CONSUMABLE','ARMOR','ACCESSORY','MATERIAL','KEYSTONE','CRYSTAL','OTHER');
ALTER TABLE `AuctionListing` ADD `currencyType` enum('MONEY','REPUTATION') DEFAULT 'MONEY' NOT NULL;
ALTER TABLE `UserRequest` ADD `spectatable` boolean DEFAULT false;