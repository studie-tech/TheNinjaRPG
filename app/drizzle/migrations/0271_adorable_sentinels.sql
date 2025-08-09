ALTER TABLE `Bloodline` ADD `difficulty` enum('Easy','Medium','Hard','Expert');
ALTER TABLE `Bloodline` ADD `traits` varchar(256);
CREATE INDEX `Bloodline_difficulty_idx` ON `Bloodline` (`difficulty`);