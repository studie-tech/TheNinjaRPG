ALTER TABLE `Bloodline` MODIFY COLUMN `statClassification` enum('Highest','None','Ninjutsu','Genjutsu','Taijutsu','Bukijutsu');
UPDATE `Bloodline` SET `statClassification` = 'None' WHERE `statClassification` = 'Highest';
ALTER TABLE `Bloodline` MODIFY COLUMN `statClassification` enum('None','Ninjutsu','Genjutsu','Taijutsu','Bukijutsu');
ALTER TABLE `Jutsu` MODIFY COLUMN `statClassification` enum('Highest','None','Ninjutsu','Genjutsu','Taijutsu','Bukijutsu');
UPDATE `Jutsu` SET `statClassification` = 'None' WHERE `statClassification` = 'Highest';
ALTER TABLE `Jutsu` MODIFY COLUMN `statClassification` enum('None','Ninjutsu','Genjutsu','Taijutsu','Bukijutsu');
ALTER TABLE `UserData` DROP COLUMN `preferredStat`;