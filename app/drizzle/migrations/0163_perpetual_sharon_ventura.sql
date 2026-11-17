ALTER TABLE `UserData` ADD `towerDefenseActiveRun` varchar(21);
ALTER TABLE `UserData` ADD `towerDefenseDutyAt` datetime(3);
UPDATE `VillageStructure` SET `name` = 'Guard Hall' WHERE `id` LIKE 'dojo-%' AND `name` = 'Dojo';
