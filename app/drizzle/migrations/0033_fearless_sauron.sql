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
	`ninjutsuMastery` = GREATEST(`ninjutsuOffence`, `ninjutsuDefence`),
	`genjutsuMastery` = GREATEST(`genjutsuOffence`, `genjutsuDefence`),
	`taijutsuMastery` = GREATEST(`taijutsuOffence`, `taijutsuDefence`),
	`bukijutsuMastery` = GREATEST(`bukijutsuOffence`, `bukijutsuDefence`),
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
	`requiredNinjutsuMastery` = CASE
		WHEN `requiredNinjutsuOffence` IS NULL AND `requiredNinjutsuDefence` IS NULL THEN NULL
		ELSE GREATEST(COALESCE(`requiredNinjutsuOffence`, 0), COALESCE(`requiredNinjutsuDefence`, 0))
	END,
	`requiredGenjutsuMastery` = CASE
		WHEN `requiredGenjutsuOffence` IS NULL AND `requiredGenjutsuDefence` IS NULL THEN NULL
		ELSE GREATEST(COALESCE(`requiredGenjutsuOffence`, 0), COALESCE(`requiredGenjutsuDefence`, 0))
	END,
	`requiredTaijutsuMastery` = CASE
		WHEN `requiredTaijutsuOffence` IS NULL AND `requiredTaijutsuDefence` IS NULL THEN NULL
		ELSE GREATEST(COALESCE(`requiredTaijutsuOffence`, 0), COALESCE(`requiredTaijutsuDefence`, 0))
	END,
	`requiredBukijutsuMastery` = CASE
		WHEN `requiredBukijutsuOffence` IS NULL AND `requiredBukijutsuDefence` IS NULL THEN NULL
		ELSE GREATEST(COALESCE(`requiredBukijutsuOffence`, 0), COALESCE(`requiredBukijutsuDefence`, 0))
	END;
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
	`requiredNinjutsuMastery` = CASE
		WHEN `requiredNinjutsuOffence` IS NULL AND `requiredNinjutsuDefence` IS NULL THEN NULL
		ELSE GREATEST(COALESCE(`requiredNinjutsuOffence`, 0), COALESCE(`requiredNinjutsuDefence`, 0))
	END,
	`requiredGenjutsuMastery` = CASE
		WHEN `requiredGenjutsuOffence` IS NULL AND `requiredGenjutsuDefence` IS NULL THEN NULL
		ELSE GREATEST(COALESCE(`requiredGenjutsuOffence`, 0), COALESCE(`requiredGenjutsuDefence`, 0))
	END,
	`requiredTaijutsuMastery` = CASE
		WHEN `requiredTaijutsuOffence` IS NULL AND `requiredTaijutsuDefence` IS NULL THEN NULL
		ELSE GREATEST(COALESCE(`requiredTaijutsuOffence`, 0), COALESCE(`requiredTaijutsuDefence`, 0))
	END,
	`requiredBukijutsuMastery` = CASE
		WHEN `requiredBukijutsuOffence` IS NULL AND `requiredBukijutsuDefence` IS NULL THEN NULL
		ELSE GREATEST(COALESCE(`requiredBukijutsuOffence`, 0), COALESCE(`requiredBukijutsuDefence`, 0))
	END;
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
UPDATE `UserData`
SET `battleId` = NULL, `status` = 'AWAKE', `travelFinishAt` = NULL
WHERE `battleId` IS NOT NULL;
DELETE FROM `Battle`;
-- Saved simulator state is a JSON blob keyed by the old per-type stat names. Nothing maps
-- it onto offence/defence, so stale rows would render as NaN damage and silently reload
-- with default stats. Drop them like the in-flight battles above.
DELETE FROM `DamageCalculation`;
