ALTER TABLE `UserData` ADD `dailyTowerDefenseRuns` smallint unsigned DEFAULT 0 NOT NULL;
ALTER TABLE `UserData` ADD `towerDefenseActiveRun` varchar(21);
UPDATE `VillageStructure` SET `name` = 'Guard Hall' WHERE `id` LIKE 'dojo-%' AND `name` = 'Dojo';
