CREATE TABLE `VillageDutyPresence` (
	`userId` varchar(191) NOT NULL,
	`sector` smallint unsigned NOT NULL,
	`expiresAt` datetime(3) NOT NULL,
	CONSTRAINT `VillageDutyPresence_userId` PRIMARY KEY(`userId`)
);

CREATE TABLE `VillageDutyShift` (
	`capacity` tinyint unsigned NOT NULL,
	`villageId` varchar(191) NOT NULL,
	`startedAt` datetime(3) NOT NULL,
	`revision` int unsigned NOT NULL DEFAULT 0,
	`patrols` json NOT NULL,
	CONSTRAINT `VillageDutyShift_villageId` PRIMARY KEY(`villageId`)
);

ALTER TABLE `VillageStructure` RENAME COLUMN `patrolsPerLvl` TO `patrolSlotsPerLvl`;
CREATE INDEX `VillageDutyPresence_sector_expiresAt_idx` ON `VillageDutyPresence` (`sector`,`expiresAt`);
CREATE INDEX `VillageDutyPresence_expiresAt_idx` ON `VillageDutyPresence` (`expiresAt`);

UPDATE `VillageStructure` SET `patrolSlotsPerLvl` = 2 WHERE `patrolSlotsPerLvl` > 0;
