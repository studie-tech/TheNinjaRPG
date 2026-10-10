ALTER TABLE `TrainingLog` MODIFY COLUMN `stat` enum('offence','defence','intelligence','speed','willpower','strength','ninjutsuMastery','genjutsuMastery','taijutsuMastery','bukijutsuMastery','bloodlineMastery','sageMastery','Fire','Water','Wind','Earth','Lightning');
ALTER TABLE `UserData` ADD `elementalMastery` json DEFAULT ('{}') NOT NULL;
ALTER TABLE `UserData` ADD `activeTrainedElement` enum('Fire','Water','Wind','Earth','Lightning');
ALTER TABLE `UserData` ADD `currentlyTrainingElement` enum('Fire','Water','Wind','Earth','Lightning');
ALTER TABLE `UserData` ADD `elementalTrainingStartedAt` datetime(3);
ALTER TABLE `UserData` ADD `elementalTrainingSpeed` enum('15min','1hr','4hrs','8hrs','12hrs','24hrs');