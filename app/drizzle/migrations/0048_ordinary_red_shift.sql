ALTER TABLE `Item` ADD `requiredSkillId` varchar(191);
ALTER TABLE `Jutsu` ADD `requiredSkillId` varchar(191);
ALTER TABLE `UserData` ADD `showPvpRecord` boolean DEFAULT false NOT NULL;
ALTER TABLE `UserData` ADD `pvpWins` int DEFAULT 0 NOT NULL;
ALTER TABLE `UserData` ADD `pvpLosses` int DEFAULT 0 NOT NULL;
CREATE INDEX `Item_requiredSkillId_idx` ON `Item` (`requiredSkillId`);
CREATE INDEX `Jutsu_requiredSkillId_idx` ON `Jutsu` (`requiredSkillId`);

-- Rebuild each player's total from the current leveling formula.
UPDATE `UserData` AS `u`
SET `u`.`skillPoints` = LEAST(
	20,
	CASE
		WHEN `u`.`rank` IN ('CHUNIN', 'JONIN', 'ELITE JONIN', 'ELDER')
			THEN GREATEST(`u`.`level` - 30, 0)
		ELSE 0
	END
)
WHERE `u`.`isAi` = 0;
