ALTER TABLE `Quest` ADD `requiredSageModeId` varchar(191);
CREATE INDEX `Quest_requiredSageMode_idx` ON `Quest` (`requiredSageModeId`);