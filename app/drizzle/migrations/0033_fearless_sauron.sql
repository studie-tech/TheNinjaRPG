ALTER TABLE `Item` ADD `requiredNinjutsuMastery` int;
ALTER TABLE `Item` ADD `requiredGenjutsuMastery` int;
ALTER TABLE `Item` ADD `requiredTaijutsuMastery` int;
ALTER TABLE `Item` ADD `requiredBukijutsuMastery` int;
ALTER TABLE `Item` ADD `requiredBloodlineMastery` int;
ALTER TABLE `Item` ADD `requiredSageMastery` int;
ALTER TABLE `Jutsu` ADD `requiredNinjutsuMastery` int;
ALTER TABLE `Jutsu` ADD `requiredGenjutsuMastery` int;
ALTER TABLE `Jutsu` ADD `requiredTaijutsuMastery` int;
ALTER TABLE `Jutsu` ADD `requiredBukijutsuMastery` int;
ALTER TABLE `Jutsu` ADD `requiredBloodlineMastery` int;
ALTER TABLE `Jutsu` ADD `requiredSageMastery` int;
ALTER TABLE `UserData` ADD `offence` double DEFAULT 10 NOT NULL;
ALTER TABLE `UserData` ADD `defence` double DEFAULT 10 NOT NULL;
ALTER TABLE `UserData` ADD `ninjutsuMastery` double DEFAULT 10 NOT NULL;
ALTER TABLE `UserData` ADD `genjutsuMastery` double DEFAULT 10 NOT NULL;
ALTER TABLE `UserData` ADD `taijutsuMastery` double DEFAULT 10 NOT NULL;
ALTER TABLE `UserData` ADD `bukijutsuMastery` double DEFAULT 10 NOT NULL;
ALTER TABLE `UserData` ADD `bloodlineMastery` double DEFAULT 10 NOT NULL;
ALTER TABLE `UserData` ADD `sageMastery` double DEFAULT 10 NOT NULL;
ALTER TABLE `UserData` ADD `masteryTrainingStartedAt` datetime(3);
ALTER TABLE `UserData` ADD `currentlyTrainingMastery` enum('ninjutsuMastery','genjutsuMastery','taijutsuMastery','bukijutsuMastery','bloodlineMastery','sageMastery');
UPDATE `UserData`
SET
	`offence` = GREATEST(`ninjutsuOffence`, `genjutsuOffence`, `taijutsuOffence`, `bukijutsuOffence`),
	`defence` = GREATEST(`ninjutsuDefence`, `genjutsuDefence`, `taijutsuDefence`, `bukijutsuDefence`),
	`ninjutsuMastery` = `ninjutsuOffence`,
	`genjutsuMastery` = `genjutsuOffence`,
	`taijutsuMastery` = `taijutsuOffence`,
	`bukijutsuMastery` = `bukijutsuOffence`,
	`bloodlineMastery` = 10,
	`sageMastery` = 10;
ALTER TABLE `UserData` MODIFY COLUMN `currentlyTraining` enum('ninjutsuOffence','taijutsuOffence','genjutsuOffence','bukijutsuOffence','ninjutsuDefence','taijutsuDefence','genjutsuDefence','bukijutsuDefence','intelligence','speed','willpower','strength','offence','defence');
UPDATE `UserData`
SET
	`currentlyTrainingMastery` = CASE `currentlyTraining`
		WHEN 'ninjutsuOffence' THEN 'ninjutsuMastery'
		WHEN 'genjutsuOffence' THEN 'genjutsuMastery'
		WHEN 'taijutsuOffence' THEN 'taijutsuMastery'
		WHEN 'bukijutsuOffence' THEN 'bukijutsuMastery'
		ELSE `currentlyTrainingMastery`
	END,
	`masteryTrainingStartedAt` = CASE
		WHEN `currentlyTraining` IN ('ninjutsuOffence', 'genjutsuOffence', 'taijutsuOffence', 'bukijutsuOffence') THEN `trainingStartedAt`
		ELSE `masteryTrainingStartedAt`
	END,
	`trainingStartedAt` = CASE
		WHEN `currentlyTraining` IN ('ninjutsuOffence', 'genjutsuOffence', 'taijutsuOffence', 'bukijutsuOffence') THEN NULL
		ELSE `trainingStartedAt`
	END,
	`currentlyTraining` = CASE `currentlyTraining`
		WHEN 'ninjutsuOffence' THEN NULL
		WHEN 'genjutsuOffence' THEN NULL
		WHEN 'taijutsuOffence' THEN NULL
		WHEN 'bukijutsuOffence' THEN NULL
		WHEN 'ninjutsuDefence' THEN 'defence'
		WHEN 'genjutsuDefence' THEN 'defence'
		WHEN 'taijutsuDefence' THEN 'defence'
		WHEN 'bukijutsuDefence' THEN 'defence'
		ELSE `currentlyTraining`
	END;
ALTER TABLE `TrainingLog` MODIFY COLUMN `stat` enum('ninjutsuOffence','taijutsuOffence','genjutsuOffence','bukijutsuOffence','ninjutsuDefence','taijutsuDefence','genjutsuDefence','bukijutsuDefence','intelligence','speed','willpower','strength','offence','defence','ninjutsuMastery','genjutsuMastery','taijutsuMastery','bukijutsuMastery','bloodlineMastery','sageMastery');
UPDATE `TrainingLog`
SET `stat` = CASE `stat`
	WHEN 'ninjutsuOffence' THEN 'ninjutsuMastery'
	WHEN 'genjutsuOffence' THEN 'genjutsuMastery'
	WHEN 'taijutsuOffence' THEN 'taijutsuMastery'
	WHEN 'bukijutsuOffence' THEN 'bukijutsuMastery'
	WHEN 'ninjutsuDefence' THEN 'defence'
	WHEN 'genjutsuDefence' THEN 'defence'
	WHEN 'taijutsuDefence' THEN 'defence'
	WHEN 'bukijutsuDefence' THEN 'defence'
	ELSE `stat`
END;
ALTER TABLE `TrainingLog` MODIFY COLUMN `stat` enum('offence','defence','intelligence','speed','willpower','strength','ninjutsuMastery','genjutsuMastery','taijutsuMastery','bukijutsuMastery','bloodlineMastery','sageMastery');
ALTER TABLE `UserData` MODIFY COLUMN `currentlyTraining` enum('offence','defence','intelligence','speed','willpower','strength');
UPDATE `Jutsu`
SET
	`requiredNinjutsuMastery` = `requiredNinjutsuOffence`,
	`requiredGenjutsuMastery` = `requiredGenjutsuOffence`,
	`requiredTaijutsuMastery` = `requiredTaijutsuOffence`,
	`requiredBukijutsuMastery` = `requiredBukijutsuOffence`;
ALTER TABLE `Jutsu` DROP COLUMN `requiredNinjutsuOffence`;
ALTER TABLE `Jutsu` DROP COLUMN `requiredNinjutsuDefence`;
ALTER TABLE `Jutsu` DROP COLUMN `requiredGenjutsuOffence`;
ALTER TABLE `Jutsu` DROP COLUMN `requiredGenjutsuDefence`;
ALTER TABLE `Jutsu` DROP COLUMN `requiredTaijutsuOffence`;
ALTER TABLE `Jutsu` DROP COLUMN `requiredTaijutsuDefence`;
ALTER TABLE `Jutsu` DROP COLUMN `requiredBukijutsuOffence`;
ALTER TABLE `Jutsu` DROP COLUMN `requiredBukijutsuDefence`;
UPDATE `Item`
SET
	`requiredNinjutsuMastery` = `requiredNinjutsuOffence`,
	`requiredGenjutsuMastery` = `requiredGenjutsuOffence`,
	`requiredTaijutsuMastery` = `requiredTaijutsuOffence`,
	`requiredBukijutsuMastery` = `requiredBukijutsuOffence`;
ALTER TABLE `Item` DROP COLUMN `requiredNinjutsuOffence`;
ALTER TABLE `Item` DROP COLUMN `requiredNinjutsuDefence`;
ALTER TABLE `Item` DROP COLUMN `requiredGenjutsuOffence`;
ALTER TABLE `Item` DROP COLUMN `requiredGenjutsuDefence`;
ALTER TABLE `Item` DROP COLUMN `requiredTaijutsuOffence`;
ALTER TABLE `Item` DROP COLUMN `requiredTaijutsuDefence`;
ALTER TABLE `Item` DROP COLUMN `requiredBukijutsuOffence`;
ALTER TABLE `Item` DROP COLUMN `requiredBukijutsuDefence`;
ALTER TABLE `UserData` DROP COLUMN `ninjutsuOffence`;
ALTER TABLE `UserData` DROP COLUMN `ninjutsuDefence`;
ALTER TABLE `UserData` DROP COLUMN `genjutsuOffence`;
ALTER TABLE `UserData` DROP COLUMN `genjutsuDefence`;
ALTER TABLE `UserData` DROP COLUMN `taijutsuOffence`;
ALTER TABLE `UserData` DROP COLUMN `taijutsuDefence`;
ALTER TABLE `UserData` DROP COLUMN `bukijutsuDefence`;
ALTER TABLE `UserData` DROP COLUMN `bukijutsuOffence`;
