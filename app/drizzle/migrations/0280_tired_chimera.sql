ALTER TABLE `Quest` ADD `requiredBloodlineId` varchar(191);
CREATE INDEX `Quest_requiredBloodline_idx` ON `Quest` (`requiredBloodlineId`);