-- Apply by hand as one SQL script, never with `make dbpush` or `drizzle-kit push`: a push
-- adds and drops the columns without the backfills below, wiping every player's stats.
-- The script fails on its first statement if run twice, preventing duplicate conversion.
-- Verify all non-AI/non-summon old combat stats are at least 10 before the cutover.
-- Preserve a database backup before the cutover. Stored converted values remain uncapped:
-- battle rank/global caps limit their use without discarding the converted entitlement.
--
-- The old and new builds cannot share a schema, because fetchUser selects every column by
-- name. Cut over in this order:
--   1. Build the new production deployment without promoting it.
--   2. Apply this script at low traffic, or behind a brief write freeze.
--   3. Apply 0053_mixed_sentinel.sql, then promote the new deployment immediately.
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
	`offence` = CASE WHEN `isAi` OR `isSummon` THEN GREATEST(`ninjutsuOffence`, `genjutsuOffence`, `taijutsuOffence`, `bukijutsuOffence`)
		ELSE 10 + (CAST(`ninjutsuOffence` AS DECIMAL(30, 10)) + CAST(`genjutsuOffence` AS DECIMAL(30, 10)) + CAST(`taijutsuOffence` AS DECIMAL(30, 10)) + CAST(`bukijutsuOffence` AS DECIMAL(30, 10)) - 40) * 1299990 / 1799960 END,
	`defence` = CASE WHEN `isAi` OR `isSummon` THEN GREATEST(`ninjutsuDefence`, `genjutsuDefence`, `taijutsuDefence`, `bukijutsuDefence`)
		ELSE 10 + (CAST(`ninjutsuDefence` AS DECIMAL(30, 10)) + CAST(`genjutsuDefence` AS DECIMAL(30, 10)) + CAST(`taijutsuDefence` AS DECIMAL(30, 10)) + CAST(`bukijutsuDefence` AS DECIMAL(30, 10)) - 40) * 1299990 / 1799960 END,
	`ninjutsuMastery` = GREATEST(`ninjutsuOffence`, `ninjutsuDefence`),
	`genjutsuMastery` = GREATEST(`genjutsuOffence`, `genjutsuDefence`),
	`taijutsuMastery` = GREATEST(`taijutsuOffence`, `taijutsuDefence`),
	`bukijutsuMastery` = GREATEST(`bukijutsuOffence`, `bukijutsuDefence`),
	`bloodlineMastery` = 10,
	`sageMastery` = 10;
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
-- Mastery training excludes minutes a combat session already credited. The cutoff has to
-- land in this update, not in TrainingLog, which is inserted afterwards.
ALTER TABLE `UserData` ADD `lastCombatTrainingFinishedAt` datetime(3);
UPDATE `UserData` AS `user`
INNER JOIN (
	SELECT `userId`, MAX(`trainingFinishedAt`) AS `finishedAt`
	FROM `TrainingLog`
	WHERE `stat` IN ('offence', 'defence', 'intelligence', 'speed', 'willpower', 'strength')
	GROUP BY `userId`
) AS `latest` ON `latest`.`userId` = `user`.`userId`
SET `user`.`lastCombatTrainingFinishedAt` = `latest`.`finishedAt`;
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
-- Apply the player investment conversion, defaulting a missing stat to 10.
UPDATE `DamageCalculation`
SET `state` = JSON_REMOVE(
	JSON_SET(
		`state`,
		'$.attacker.offence', 10 + (CAST(COALESCE(JSON_EXTRACT(`state`, '$.attacker.ninjutsuOffence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.attacker.genjutsuOffence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.attacker.taijutsuOffence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.attacker.bukijutsuOffence') + 0, 10) AS DECIMAL(30, 10)) - 40) * 1299990 / 1799960,
		'$.attacker.defence', 10 + (CAST(COALESCE(JSON_EXTRACT(`state`, '$.attacker.ninjutsuDefence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.attacker.genjutsuDefence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.attacker.taijutsuDefence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.attacker.bukijutsuDefence') + 0, 10) AS DECIMAL(30, 10)) - 40) * 1299990 / 1799960,
		'$.defender.offence', 10 + (CAST(COALESCE(JSON_EXTRACT(`state`, '$.defender.ninjutsuOffence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.defender.genjutsuOffence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.defender.taijutsuOffence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.defender.bukijutsuOffence') + 0, 10) AS DECIMAL(30, 10)) - 40) * 1299990 / 1799960,
		'$.defender.defence', 10 + (CAST(COALESCE(JSON_EXTRACT(`state`, '$.defender.ninjutsuDefence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.defender.genjutsuDefence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.defender.taijutsuDefence') + 0, 10) AS DECIMAL(30, 10)) + CAST(COALESCE(JSON_EXTRACT(`state`, '$.defender.bukijutsuDefence') + 0, 10) AS DECIMAL(30, 10)) - 40) * 1299990 / 1799960
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
-- Seeded guide articles and content are never overwritten, so text describing the per-type
-- stats is corrected here. Each update is guarded on the old wording and leaves a row that
-- was edited since untouched.
UPDATE `GuideArticle`
SET `content` = REPLACE(`content`, 'Train offensive taijutsu (or another offence) in short 15-minute bouts when you can.', 'Train Offence in short 15-minute bouts when you can, and a mastery such as Taijutsu alongside it to unlock jutsu and gear of that type.')
WHERE `slug` = 'getting-started' AND `content` LIKE '%Train offensive taijutsu (or another offence) in short 15-minute bouts when you can.%';
-- Jutsu text that names a removed per-type stat, or credits a per-type stat buff or debuff
-- to that type although it now moves the shared Offence.
UPDATE `Jutsu`
SET `description` = REPLACE(`description`, 'crippling their taijutsu and bukijutsu power', 'crippling their Offence, Strength and Speed')
WHERE `id` = 'hdlYuZCWCXn02GUPBEzBk' AND `description` LIKE '%crippling their taijutsu and bukijutsu power%';
UPDATE `Jutsu`
SET `description` = REPLACE(`description`, 'reducing their Genjutsu capabilities', 'reducing their Offence, Intelligence and Willpower')
WHERE `id` = '_bb_t15T2F8E6OBEk-S3U' AND `description` LIKE '%reducing their Genjutsu capabilities%';
UPDATE `Jutsu`
SET `battleDescription` = REPLACE(`battleDescription`, 'diminishing their Genjutsu prowess', 'diminishing their Offence, Intelligence and Willpower')
WHERE `id` = '_bb_t15T2F8E6OBEk-S3U' AND `battleDescription` LIKE '%diminishing their Genjutsu prowess%';
UPDATE `Jutsu`
SET `description` = REPLACE(`description`, 'genjutsu offense, intelligence, and willpower', 'Offence, Intelligence and Willpower')
WHERE `id` = 'i_tI_-M-GUfQNn25E7dte' AND `description` LIKE '%genjutsu offense, intelligence, and willpower%';
UPDATE `Jutsu`
SET `battleDescription` = REPLACE(`battleDescription`, 'genjutsu offense, intelligence, and willpower', 'Offence, Intelligence and Willpower')
WHERE `id` = 'i_tI_-M-GUfQNn25E7dte' AND `battleDescription` LIKE '%genjutsu offense, intelligence, and willpower%';
UPDATE `Jutsu`
SET `battleDescription` = REPLACE(`battleDescription`, 'boosting their ninjutsu potency', 'boosting their Offence')
WHERE `id` = '8762uSiA_XClK36cuE9Cw' AND `battleDescription` LIKE '%boosting their ninjutsu potency%';
UPDATE `Jutsu`
SET `description` = REPLACE(`description`, 'Bukijutsu, Strength, and Speed', 'Offence, Strength and Speed')
WHERE `id` = 'sBc4_bIw5xCB-39X6FcJy' AND `description` LIKE '%Bukijutsu, Strength, and Speed%';
UPDATE `Jutsu`
SET `battleDescription` = REPLACE(`battleDescription`, 'heightening their Bukijutsu might, strength, and speed', 'heightening their Offence, Strength and Speed')
WHERE `id` = 'sBc4_bIw5xCB-39X6FcJy' AND `battleDescription` LIKE '%heightening their Bukijutsu might, strength, and speed%';
UPDATE `Jutsu`
SET `description` = REPLACE(`description`, 'hand-to-hand power', 'Offence, Strength and Speed')
WHERE `id` = 'x5FfBkac3YfROuNojxU8k' AND `description` LIKE '%hand-to-hand power%';
UPDATE `Jutsu`
SET `battleDescription` = REPLACE(`battleDescription`, 'sharpening their Taijutsu ability', 'sharpening their Offence')
WHERE `id` = 'x5FfBkac3YfROuNojxU8k' AND `battleDescription` LIKE '%sharpening their Taijutsu ability%';
UPDATE `Jutsu`
SET `description` = REPLACE(`description`, 'bukijutsu offense', 'bukijutsu damage')
WHERE `id` = '_BTsbIMz0WUWczPp9iRyW' AND `description` LIKE '%bukijutsu offense%';
UPDATE `Jutsu`
SET `description` = REPLACE(`description`, 'genjutsu defense, intelligence, and willpower', 'defenses')
WHERE `id` = 'eJISnE5IrvC09FuoeuQ5X' AND `description` LIKE '%genjutsu defense, intelligence, and willpower%';
UPDATE `Jutsu`
SET `battleDescription` = REPLACE(`battleDescription`, 'weakening their Bukijutsu defenses', 'weakening their defenses')
WHERE `id` = 'iioSrLkg_-jlX5xIycMYr' AND `battleDescription` LIKE '%weakening their Bukijutsu defenses%';
UPDATE `Jutsu`
SET `battleDescription` = REPLACE(`battleDescription`, ' by weakening their ninjutsu defense, intelligence, and willpower', '')
WHERE `id` = 'mdIWNxovAIVj_8esBaYGX' AND `battleDescription` LIKE '% by weakening their ninjutsu defense, intelligence, and willpower%';
UPDATE `Jutsu`
SET `battleDescription` = REPLACE(`battleDescription`, ' by weakening their intelligence, willpower, and ninjutsu defenses', '')
WHERE `id` = 'TI1JQAG1ltx_uLHE9-UUs' AND `battleDescription` LIKE '% by weakening their intelligence, willpower, and ninjutsu defenses%';
