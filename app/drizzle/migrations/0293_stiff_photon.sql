ALTER TABLE `UserData` RENAME COLUMN `audioOn` TO `musicOn`;
ALTER TABLE `UserData` ADD `sfxOn` boolean DEFAULT true NOT NULL;