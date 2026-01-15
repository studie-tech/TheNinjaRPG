ALTER TABLE `Item` ADD `craftingExperience` int DEFAULT 0 NOT NULL;
ALTER TABLE `Quest` ADD `gatheringRank` enum('NONE','D RANK','C RANK','B RANK','A RANK','S RANK') DEFAULT 'NONE';