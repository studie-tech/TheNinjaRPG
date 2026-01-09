START TRANSACTION;

-- (1) & (2) Update rows with NULL or invalid questType to 'starter'
UPDATE `Quest` 
SET `questType` = 'starter' 
WHERE `questType` IS NULL 
   OR `questType` NOT IN ('starter','tier','daily','mission','errand','crime','exam','event','story','anbu','medical','hunting','gathering','battlepyramid','pvp','achievement','war');

UPDATE `QuestHistory` 
SET `questType` = 'starter' 
WHERE `questType` IS NULL 
   OR `questType` NOT IN ('starter','tier','daily','mission','errand','crime','exam','event','story','anbu','medical','hunting','gathering','battlepyramid','pvp','achievement','war');

-- (3) Re-read to ensure no NULLs remain (implicit in the NOT NULL constraint below)
-- Add temporary DEFAULT to avoid failures during the change, then MODIFY to NOT NULL
ALTER TABLE `Quest` MODIFY COLUMN `questType` enum('starter','tier','daily','mission','errand','crime','exam','event','story','anbu','medical','hunting','gathering','battlepyramid','pvp','achievement','war') NOT NULL DEFAULT 'starter';
ALTER TABLE `QuestHistory` MODIFY COLUMN `questType` enum('starter','tier','daily','mission','errand','crime','exam','event','story','anbu','medical','hunting','gathering','battlepyramid','pvp','achievement','war') NOT NULL DEFAULT 'starter';

-- Remove the temporary DEFAULT to match the schema.ts definition
ALTER TABLE `Quest` ALTER COLUMN `questType` DROP DEFAULT;
ALTER TABLE `QuestHistory` ALTER COLUMN `questType` DROP DEFAULT;

-- Rest of the migration
ALTER TABLE `VillageStructure` ADD `temporaryLevelBonus` int DEFAULT 0 NOT NULL;
ALTER TABLE `VillageStructure` ADD `temporaryLevelBonusExpiresAt` datetime(3);
ALTER TABLE `War` ADD `attackerWarHealth` int DEFAULT 10000 NOT NULL;
ALTER TABLE `War` ADD `defenderWarHealth` int DEFAULT 10000 NOT NULL;
ALTER TABLE `War` ADD `attackerWarHealthMax` int DEFAULT 10000 NOT NULL;
ALTER TABLE `War` ADD `defenderWarHealthMax` int DEFAULT 10000 NOT NULL;
UPDATE `Village` SET `allianceSystem` = 1 WHERE `type` IN ('HIDEOUT', 'TOWN');

COMMIT;
