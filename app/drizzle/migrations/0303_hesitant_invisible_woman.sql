ALTER TABLE `Item` ADD `crystalTargetTypes` varchar(191) DEFAULT ('') NOT NULL;

-- Set skill points to 20 for users above level 40 (they would have earned all leveling skill points)
UPDATE `UserData` SET `skillPoints` = 20 WHERE `level` > 40;