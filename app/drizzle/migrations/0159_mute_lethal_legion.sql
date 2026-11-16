ALTER TABLE `Item` ADD `craftingOutputQuantity` int DEFAULT 1 NOT NULL;
ALTER TABLE `UserQueue` ADD `craftBatches` int unsigned;