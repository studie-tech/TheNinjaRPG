ALTER TABLE `PaypalSubscription` MODIFY COLUMN `federalStatus` enum('NONE','NORMAL','SILVER','GOLD','DIAMOND') NOT NULL;
ALTER TABLE `StorePurchase` MODIFY COLUMN `federalStatus` enum('NONE','NORMAL','SILVER','GOLD','DIAMOND');
ALTER TABLE `StripeCheckout` MODIFY COLUMN `federalStatus` enum('NONE','NORMAL','SILVER','GOLD','DIAMOND') NOT NULL DEFAULT 'NONE';
ALTER TABLE `StripePayment` MODIFY COLUMN `federalStatusOverride` enum('NONE','NORMAL','SILVER','GOLD','DIAMOND');
ALTER TABLE `StripePayment` MODIFY COLUMN `federalStatus` enum('NONE','NORMAL','SILVER','GOLD','DIAMOND') NOT NULL DEFAULT 'NONE';
ALTER TABLE `UserData` MODIFY COLUMN `federalStatus` enum('NONE','NORMAL','SILVER','GOLD','DIAMOND') NOT NULL DEFAULT 'NONE';
ALTER TABLE `UserData` ADD `diamondBloodlineActive` boolean DEFAULT false NOT NULL;
ALTER TABLE `UserData` ADD `preDiamondBloodlineId` varchar(191);
CREATE INDEX `UserData_diamondBloodlineActive_idx` ON `UserData` (`diamondBloodlineActive`);