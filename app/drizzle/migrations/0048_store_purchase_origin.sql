ALTER TABLE `StorePurchase` ADD `originalUserId` varchar(191);
UPDATE `StorePurchase` SET `originalUserId` = `userId` WHERE `originalUserId` IS NULL;
ALTER TABLE `StorePurchase` MODIFY `originalUserId` varchar(191) NOT NULL;
CREATE INDEX `StorePurchase_originalUserId_store_idx` ON `StorePurchase` (`originalUserId`,`store`);
