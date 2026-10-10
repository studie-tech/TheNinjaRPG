ALTER TABLE `Jutsu` ADD `reskinParentJutsuId` varchar(191);
ALTER TABLE `Jutsu` ADD `bloodlineReskinId` varchar(191);
CREATE INDEX `Jutsu_reskinParentJutsuId_idx` ON `Jutsu` (`reskinParentJutsuId`);
CREATE INDEX `Jutsu_bloodlineReskinId_idx` ON `Jutsu` (`bloodlineReskinId`);