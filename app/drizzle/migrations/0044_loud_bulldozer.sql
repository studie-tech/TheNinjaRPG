ALTER TABLE `Item` ADD `requiredSkillId` varchar(191);
ALTER TABLE `Jutsu` ADD `requiredSkillId` varchar(191);
CREATE INDEX `Item_requiredSkillId_idx` ON `Item` (`requiredSkillId`);
CREATE INDEX `Jutsu_requiredSkillId_idx` ON `Jutsu` (`requiredSkillId`);