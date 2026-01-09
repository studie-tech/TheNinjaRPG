ALTER TABLE `Quest` MODIFY COLUMN `questType` enum('starter','tier','daily','mission','errand','crime','exam','event','story','anbu','medical','hunting','gathering','battlepyramid','pvp','achievement','war') NOT NULL;
ALTER TABLE `QuestHistory` MODIFY COLUMN `questType` enum('starter','tier','daily','mission','errand','crime','exam','event','story','anbu','medical','hunting','gathering','battlepyramid','pvp','achievement','war') NOT NULL;
ALTER TABLE `VillageStructure` ADD `temporaryLevelBonus` int DEFAULT 0 NOT NULL;
ALTER TABLE `VillageStructure` ADD `temporaryLevelBonusExpiresAt` datetime(3);
ALTER TABLE `War` ADD `attackerWarHealth` int DEFAULT 10000 NOT NULL;
ALTER TABLE `War` ADD `defenderWarHealth` int DEFAULT 10000 NOT NULL;
ALTER TABLE `War` ADD `attackerWarHealthMax` int DEFAULT 10000 NOT NULL;
ALTER TABLE `War` ADD `defenderWarHealthMax` int DEFAULT 10000 NOT NULL;