-- Migrate existing ITEM_7 data to THROWN before removing from enum
UPDATE `UserItem` SET `equipped` = 'THROWN' WHERE `equipped` = 'ITEM_7';

-- Now safe to remove ITEM_7 from enum
ALTER TABLE `Item` MODIFY COLUMN `slot` enum('HEAD','CHEST','LEGS','FEET','HAND','THROWN','ITEM','WAIST','KEYSTONE','NONE') NOT NULL;
ALTER TABLE `UserItem` MODIFY COLUMN `equipped` enum('HEAD','CHEST','LEGS','FEET','HAND_1','HAND_2','THROWN','WAIST','KEYSTONE','ITEM_1','ITEM_2','ITEM_3','ITEM_4','ITEM_5','ITEM_6','NONE') NOT NULL DEFAULT 'NONE';
