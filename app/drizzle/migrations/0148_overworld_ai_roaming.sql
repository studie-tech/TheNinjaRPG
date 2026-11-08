ALTER TABLE `OverworldAiPlacement` MODIFY COLUMN `sectorType` enum('specific','random','from_list','biome') NOT NULL DEFAULT 'specific';
ALTER TABLE `OverworldAiPlacement` MODIFY COLUMN `interactionType` enum('FRIENDLY','HOSTILE','AMBIENT') NOT NULL;
ALTER TABLE `OverworldAiPlacement` ADD `wanderRadius` tinyint unsigned DEFAULT 5 NOT NULL;
ALTER TABLE `OverworldAiPlacement` ADD `spawnCount` smallint unsigned DEFAULT 1 NOT NULL;
ALTER TABLE `OverworldAiPlacement` ADD `groupMin` tinyint unsigned DEFAULT 1 NOT NULL;
ALTER TABLE `OverworldAiPlacement` ADD `groupMax` tinyint unsigned DEFAULT 1 NOT NULL;
ALTER TABLE `OverworldAiPlacement` ADD `habitats` json DEFAULT (JSON_ARRAY()) NOT NULL;
ALTER TABLE `OverworldAiPlacement` ADD `wildOnly` boolean DEFAULT false NOT NULL;
ALTER TABLE `OverworldAiPlacement` ADD `mapScale` smallint unsigned DEFAULT 100 NOT NULL;