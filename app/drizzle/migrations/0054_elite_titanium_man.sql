-- With gameplay writes frozen, run `make bun scripts/settle-energy-training.ts`
-- after 0052/0053, before this script. Preserve a backup before the cutover.
-- Refuse to discard unsettled sessions; this INSERT fails if any remain.
-- If a guard INSERT fails, no UserData schema change has started. Keep writes frozen, rerun
-- settlement successfully, DROP TABLE `_EnergyTrainingGuard`, and retry this script.
-- A failure after the guards requires inspecting the applied statements before resuming;
-- never replay completed ALTERs or the full-pool backfill after gameplay resumes.
CREATE TABLE `_EnergyTrainingGuard` (`id` int PRIMARY KEY);
INSERT INTO `_EnergyTrainingGuard` VALUES (1);
INSERT INTO `_EnergyTrainingGuard` SELECT 1 FROM `UserData` WHERE `currentlyTraining` IS NOT NULL OR `currentlyTrainingMastery` IS NOT NULL LIMIT 1;
INSERT INTO `_EnergyTrainingGuard` SELECT 1 FROM `UserData` LEFT JOIN `_EnergyPool` ON `UserData`.`userId` = `_EnergyPool`.`userId` WHERE `_EnergyPool`.`userId` IS NULL LIMIT 1;
DROP TABLE `_EnergyTrainingGuard`;
ALTER TABLE `UserData` ADD `curEnergy` double DEFAULT 100 NOT NULL;
ALTER TABLE `UserData` ADD `maxEnergy` double DEFAULT 100 NOT NULL;
UPDATE `UserData` JOIN `_EnergyPool` ON `UserData`.`userId` = `_EnergyPool`.`userId` SET `maxEnergy` = `_EnergyPool`.`capacity`, `curEnergy` = `_EnergyPool`.`capacity`;
DROP TABLE `_EnergyPool`;
ALTER TABLE `UserData` DROP COLUMN `trainingStartedAt`;
ALTER TABLE `UserData` DROP COLUMN `lastCombatTrainingFinishedAt`;
ALTER TABLE `UserData` DROP COLUMN `currentlyTraining`;

-- Preserve staff edits while updating legacy and mastery-era getting-started guidance.
UPDATE `GuideArticle`
SET `content` = REPLACE(`content`, 'Train offensive taijutsu (or another offence) in short 15-minute bouts when you can.', 'Spend Energy to train Offence instantly, and train a mastery such as Taijutsu in timed sessions alongside it to unlock jutsu and gear of that type.')
WHERE `slug` = 'getting-started' AND `content` LIKE '%Train offensive taijutsu (or another offence) in short 15-minute bouts when you can.%';
UPDATE `GuideArticle`
SET `content` = REPLACE(`content`, 'Train Offence in short 15-minute bouts when you can, and a mastery such as Taijutsu alongside it to unlock jutsu and gear of that type.', 'Spend Energy to train Offence instantly, and train a mastery such as Taijutsu in timed sessions alongside it to unlock jutsu and gear of that type.')
WHERE `slug` = 'getting-started' AND `content` LIKE '%Train Offence in short 15-minute bouts when you can, and a mastery such as Taijutsu alongside it to unlock jutsu and gear of that type.%';
