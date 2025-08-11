ALTER TABLE `Item` ADD `maxDurability` smallint unsigned DEFAULT 100 NOT NULL;
ALTER TABLE `UserItem` ADD `durability` smallint unsigned DEFAULT 100 NOT NULL;