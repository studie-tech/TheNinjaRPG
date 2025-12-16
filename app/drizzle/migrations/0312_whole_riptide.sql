ALTER TABLE `Item` ADD `battleUsageType` enum('PVE','PVP','BOTH') DEFAULT 'BOTH' NOT NULL;
ALTER TABLE `Jutsu` ADD `battleUsageType` enum('PVE','PVP','BOTH') DEFAULT 'BOTH' NOT NULL;