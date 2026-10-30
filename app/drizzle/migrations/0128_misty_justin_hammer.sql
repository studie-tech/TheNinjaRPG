ALTER TABLE `UserData` MODIFY COLUMN `curHealth` int unsigned NOT NULL DEFAULT 100;
ALTER TABLE `UserData` MODIFY COLUMN `maxHealth` int unsigned NOT NULL DEFAULT 100;
ALTER TABLE `UserData` ADD `aiHealthOverride` int unsigned;