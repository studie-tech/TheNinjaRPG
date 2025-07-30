ALTER TABLE `Item` MODIFY COLUMN `method` enum('SINGLE','ALL','AOE_CIRCLE_SPAWN','AOE_LINE_SHOOT','AOE_WALL_SHOOT','AOE_LARGE_WALL_SHOOT','AOE_CIRCLE_SHOOT','AOE_SPIRAL_SHOOT') NOT NULL DEFAULT 'SINGLE';
ALTER TABLE `Jutsu` MODIFY COLUMN `method` enum('SINGLE','ALL','AOE_CIRCLE_SPAWN','AOE_LINE_SHOOT','AOE_WALL_SHOOT','AOE_LARGE_WALL_SHOOT','AOE_CIRCLE_SHOOT','AOE_SPIRAL_SHOOT') NOT NULL DEFAULT 'SINGLE';
ALTER TABLE `Sector` ADD `shrineLevel` tinyint DEFAULT 1 NOT NULL;
ALTER TABLE `Sector` ADD `capturedAt` datetime(3);
ALTER TABLE `Sector` ADD `nextMaintainanceDueDate` datetime(3);
ALTER TABLE `UserData` ADD `inShrines` boolean DEFAULT false NOT NULL;
ALTER TABLE `Village` ADD `shrineSettings` json DEFAULT ('{"unlockedAiIds":[],"activeBoosts":{},"activeAiIds":[]}') NOT NULL;
ALTER TABLE `War` ADD `shrineMaxHp` smallint DEFAULT 3000 NOT NULL;
CREATE INDEX `UserData_inShrines_idx` ON `UserData` (`inShrines`);