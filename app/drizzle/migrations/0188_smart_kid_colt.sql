ALTER TABLE `CraftingServicePrice` MODIFY COLUMN `service` enum('CRAFT','IMBUE','DISIMBUE','REPAIR','FORTIFY') NOT NULL;
ALTER TABLE `CraftingServiceRequest` MODIFY COLUMN `service` enum('CRAFT','IMBUE','DISIMBUE','REPAIR','FORTIFY') NOT NULL;
ALTER TABLE `CraftingServiceRequest` ADD `fortify` json;
ALTER TABLE `Item` ADD `canBeEnhanced` boolean DEFAULT false NOT NULL;
ALTER TABLE `UserItem` ADD `fortification` json;