ALTER TABLE `Item` ADD `lpcProfile` varchar(32);
ALTER TABLE `Item` ADD `lpcColor` varchar(16);
ALTER TABLE `ItemVariant` ADD `lpcProfile` varchar(32);
ALTER TABLE `ItemVariant` ADD `lpcColor` varchar(16);
ALTER TABLE `UserData` ADD `spriteBodyStyle` enum('male','female');