-- Apply by hand as one SQL script, never with `make dbpush` or `drizzle-kit push`: a push
-- adds and drops the columns without the backfills below, wiping every player's stats.
-- The script is not idempotent and fails on its first statement if run twice.
--
-- The old and new builds cannot share a schema, because fetchUser selects every column by
-- name. Cut over in this order:
--   1. Build the new production deployment without promoting it.
--   2. Apply this script at low traffic, or behind a brief write freeze.
--   3. Promote the new deployment immediately.
--   4. Apply the same script to tnr/development and to the theninja-ai database.
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
-- "Highest" damage takes the type of the highest combat mastery. Merging each type's offence
-- and defence ties those masteries for players who trained their defences evenly, so keep
-- the mastery of a player's single highest offence strictly on top where it would tie.
UPDATE `UserData`
SET `ninjutsuMastery` = `ninjutsuMastery` + 1
WHERE (`preferredStat` IS NULL OR `preferredStat` = 'Highest')
	AND `ninjutsuOffence` > GREATEST(`genjutsuOffence`, `taijutsuOffence`, `bukijutsuOffence`)
	AND `ninjutsuMastery` = GREATEST(`genjutsuMastery`, `taijutsuMastery`, `bukijutsuMastery`);
UPDATE `UserData`
SET `genjutsuMastery` = `genjutsuMastery` + 1
WHERE (`preferredStat` IS NULL OR `preferredStat` = 'Highest')
	AND `genjutsuOffence` > GREATEST(`ninjutsuOffence`, `taijutsuOffence`, `bukijutsuOffence`)
	AND `genjutsuMastery` = GREATEST(`ninjutsuMastery`, `taijutsuMastery`, `bukijutsuMastery`);
UPDATE `UserData`
SET `taijutsuMastery` = `taijutsuMastery` + 1
WHERE (`preferredStat` IS NULL OR `preferredStat` = 'Highest')
	AND `taijutsuOffence` > GREATEST(`ninjutsuOffence`, `genjutsuOffence`, `bukijutsuOffence`)
	AND `taijutsuMastery` = GREATEST(`ninjutsuMastery`, `genjutsuMastery`, `bukijutsuMastery`);
UPDATE `UserData`
SET `bukijutsuMastery` = `bukijutsuMastery` + 1
WHERE (`preferredStat` IS NULL OR `preferredStat` = 'Highest')
	AND `bukijutsuOffence` > GREATEST(`ninjutsuOffence`, `genjutsuOffence`, `taijutsuOffence`)
	AND `bukijutsuMastery` = GREATEST(`ninjutsuMastery`, `genjutsuMastery`, `taijutsuMastery`);
ALTER TABLE `UserData` MODIFY COLUMN `currentlyTraining` enum('ninjutsuOffence','taijutsuOffence','genjutsuOffence','bukijutsuOffence','ninjutsuDefence','taijutsuDefence','genjutsuDefence','bukijutsuDefence','intelligence','speed','willpower','strength','offence','defence');
-- Sessions in flight on a per-type stat keep running, with their start time, on the stat
-- it merged into, so they still pay experience when stopped.
UPDATE `UserData`
SET `currentlyTraining` = CASE
	WHEN `currentlyTraining` IN ('ninjutsuOffence', 'genjutsuOffence', 'taijutsuOffence', 'bukijutsuOffence') THEN 'offence'
	ELSE 'defence'
END
WHERE `currentlyTraining` IN ('ninjutsuOffence', 'genjutsuOffence', 'taijutsuOffence', 'bukijutsuOffence', 'ninjutsuDefence', 'genjutsuDefence', 'taijutsuDefence', 'bukijutsuDefence');
ALTER TABLE `TrainingLog` MODIFY COLUMN `stat` enum('ninjutsuOffence','taijutsuOffence','genjutsuOffence','bukijutsuOffence','ninjutsuDefence','taijutsuDefence','genjutsuDefence','bukijutsuDefence','intelligence','speed','willpower','strength','offence','defence','ninjutsuMastery','genjutsuMastery','taijutsuMastery','bukijutsuMastery','bloodlineMastery','sageMastery');
UPDATE `TrainingLog`
SET `stat` = CASE
	WHEN `stat` IN ('ninjutsuOffence', 'genjutsuOffence', 'taijutsuOffence', 'bukijutsuOffence') THEN 'offence'
	ELSE 'defence'
END
WHERE `stat` IN ('ninjutsuOffence', 'genjutsuOffence', 'taijutsuOffence', 'bukijutsuOffence', 'ninjutsuDefence', 'genjutsuDefence', 'taijutsuDefence', 'bukijutsuDefence');
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
-- Open raid, shrine and clan queues whose battle is deleted would still count as started and
-- lock their members out of every queue, and undecided tournament matches would keep their
-- fight button hidden. Remove those queues and reopen those matches.
DELETE `u` FROM `MpvpBattleUser` `u`
JOIN `MpvpBattleQueue` `q` ON `q`.`id` = `u`.`clanBattleId`
WHERE `q`.`winnerId` IS NULL AND `q`.`battleId` IN (SELECT `id` FROM `Battle`);
DELETE FROM `MpvpBattleQueue`
WHERE `winnerId` IS NULL AND `battleId` IN (SELECT `id` FROM (SELECT `id` FROM `Battle`) `b`);
UPDATE `TournamentMatch`
SET `battleId` = NULL
WHERE `winnerId` IS NULL AND `battleId` IN (SELECT `id` FROM `Battle`);
DELETE FROM `Battle`;
-- Saved damage simulations keep each side's stats as JSON under the old per-type names.
-- Merge them the way the UserData columns were merged, defaulting a missing stat to 10.
UPDATE `DamageCalculation`
SET `state` = JSON_REMOVE(
	JSON_SET(
		`state`,
		'$.attacker.offence', GREATEST(
			COALESCE(JSON_EXTRACT(`state`, '$.attacker.ninjutsuOffence') + 0, 10),
			COALESCE(JSON_EXTRACT(`state`, '$.attacker.genjutsuOffence') + 0, 10),
			COALESCE(JSON_EXTRACT(`state`, '$.attacker.taijutsuOffence') + 0, 10),
			COALESCE(JSON_EXTRACT(`state`, '$.attacker.bukijutsuOffence') + 0, 10)
		),
		'$.attacker.defence', GREATEST(
			COALESCE(JSON_EXTRACT(`state`, '$.attacker.ninjutsuDefence') + 0, 10),
			COALESCE(JSON_EXTRACT(`state`, '$.attacker.genjutsuDefence') + 0, 10),
			COALESCE(JSON_EXTRACT(`state`, '$.attacker.taijutsuDefence') + 0, 10),
			COALESCE(JSON_EXTRACT(`state`, '$.attacker.bukijutsuDefence') + 0, 10)
		),
		'$.defender.offence', GREATEST(
			COALESCE(JSON_EXTRACT(`state`, '$.defender.ninjutsuOffence') + 0, 10),
			COALESCE(JSON_EXTRACT(`state`, '$.defender.genjutsuOffence') + 0, 10),
			COALESCE(JSON_EXTRACT(`state`, '$.defender.taijutsuOffence') + 0, 10),
			COALESCE(JSON_EXTRACT(`state`, '$.defender.bukijutsuOffence') + 0, 10)
		),
		'$.defender.defence', GREATEST(
			COALESCE(JSON_EXTRACT(`state`, '$.defender.ninjutsuDefence') + 0, 10),
			COALESCE(JSON_EXTRACT(`state`, '$.defender.genjutsuDefence') + 0, 10),
			COALESCE(JSON_EXTRACT(`state`, '$.defender.taijutsuDefence') + 0, 10),
			COALESCE(JSON_EXTRACT(`state`, '$.defender.bukijutsuDefence') + 0, 10)
		)
	),
	'$.attacker.ninjutsuOffence', '$.attacker.genjutsuOffence', '$.attacker.taijutsuOffence', '$.attacker.bukijutsuOffence',
	'$.attacker.ninjutsuDefence', '$.attacker.genjutsuDefence', '$.attacker.taijutsuDefence', '$.attacker.bukijutsuDefence',
	'$.defender.ninjutsuOffence', '$.defender.genjutsuOffence', '$.defender.taijutsuOffence', '$.defender.bukijutsuOffence',
	'$.defender.ninjutsuDefence', '$.defender.genjutsuDefence', '$.defender.taijutsuDefence', '$.defender.bukijutsuDefence'
)
WHERE JSON_CONTAINS_PATH(
	`state`, 'one',
	'$.attacker.ninjutsuOffence', '$.attacker.genjutsuOffence', '$.attacker.taijutsuOffence', '$.attacker.bukijutsuOffence',
	'$.attacker.ninjutsuDefence', '$.attacker.genjutsuDefence', '$.attacker.taijutsuDefence', '$.attacker.bukijutsuDefence',
	'$.defender.ninjutsuOffence', '$.defender.genjutsuOffence', '$.defender.taijutsuOffence', '$.defender.bukijutsuOffence',
	'$.defender.ninjutsuDefence', '$.defender.genjutsuDefence', '$.defender.taijutsuDefence', '$.defender.bukijutsuDefence'
);
