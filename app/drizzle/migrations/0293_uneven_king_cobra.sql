ALTER TABLE `Item` ADD `bloodlineId` varchar(191);
CREATE INDEX `Item_bloodlineId_idx` ON `Item` (`bloodlineId`);