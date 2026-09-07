ALTER TABLE `Item` ADD `requiredSkillId` varchar(191);
ALTER TABLE `Jutsu` ADD `requiredSkillId` varchar(191);
ALTER TABLE `UserData` ADD `showPvpRecord` boolean DEFAULT false NOT NULL;
ALTER TABLE `UserData` ADD `pvpWins` int DEFAULT 0 NOT NULL;
ALTER TABLE `UserData` ADD `pvpLosses` int DEFAULT 0 NOT NULL;
CREATE INDEX `Item_requiredSkillId_idx` ON `Item` (`requiredSkillId`);
CREATE INDEX `Jutsu_requiredSkillId_idx` ON `Jutsu` (`requiredSkillId`);