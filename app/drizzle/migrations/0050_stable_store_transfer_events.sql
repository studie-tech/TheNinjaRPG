ALTER TABLE `StorePurchaseTransfer` ADD `eventId` varchar(191);
UPDATE `StorePurchaseTransfer` SET `eventId` = `id` WHERE `eventId` IS NULL;
ALTER TABLE `StorePurchaseTransfer` MODIFY `eventId` varchar(191) NOT NULL;
ALTER TABLE `StorePurchaseTransfer` ADD CONSTRAINT `StorePurchaseTransfer_eventId_sourceUserId_store_key` UNIQUE(`eventId`,`sourceUserId`,`store`);
CREATE INDEX `StorePurchaseTransfer_sourceUserId_store_transferredAt_idx` ON `StorePurchaseTransfer` (`sourceUserId`,`store`,`transferredAt`);
ALTER TABLE `StorePurchaseTransfer` DROP INDEX `StorePurchaseTransfer_sourceUserId_store_transferredAt_key`;
