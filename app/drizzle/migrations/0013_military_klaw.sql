ALTER TABLE `Jutsu` ADD `requiredBloodlineItemId` varchar(191);
CREATE INDEX `Jutsu_requiredBloodlineItemId_idx` ON `Jutsu` (`requiredBloodlineItemId`);