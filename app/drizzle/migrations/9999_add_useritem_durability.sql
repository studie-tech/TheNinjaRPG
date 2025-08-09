-- Add durability fields to UserItem
ALTER TABLE `UserItem`
  ADD COLUMN `durability` SMALLINT UNSIGNED NOT NULL DEFAULT 100 AFTER `equipped`,
  ADD COLUMN `maxDurability` SMALLINT UNSIGNED NOT NULL DEFAULT 100 AFTER `durability`;
