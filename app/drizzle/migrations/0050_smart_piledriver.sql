ALTER TABLE `FishingSession` ADD `engineVersion` tinyint unsigned DEFAULT 1 NOT NULL;
ALTER TABLE `FishingSession` ADD `habitatId` varchar(191);
ALTER TABLE `FishingSession` ADD `simulationState` json;
ALTER TABLE `FishingSession` ADD `lastInputSequence` int unsigned DEFAULT 0 NOT NULL;