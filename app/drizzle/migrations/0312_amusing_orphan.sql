ALTER TABLE `Item` ADD `battleUsageType` enum('PVE','PVP','BOTH') DEFAULT 'BOTH' NOT NULL;
ALTER TABLE `Jutsu` ADD `battleUsageType` enum('PVE','PVP','BOTH') DEFAULT 'BOTH' NOT NULL;
ALTER TABLE `JutsuLoadout` ADD `battleType` enum('PVE','PVP') DEFAULT 'PVP' NOT NULL;
ALTER TABLE `UserData` ADD `pveJutsuLoadout` varchar(191);
CREATE INDEX `UserData_pveJutsuLoadout_idx` ON `UserData` (`pveJutsuLoadout`);