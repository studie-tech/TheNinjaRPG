ALTER TABLE `UserData` ADD `newsReadIds` json DEFAULT ('[]') NOT NULL;
ALTER TABLE `UserData` ADD `newsVersion` int DEFAULT 0 NOT NULL;
ALTER TABLE `UserData` DROP COLUMN `newsReadAt`;