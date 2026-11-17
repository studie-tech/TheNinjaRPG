ALTER TABLE `AiProfile` DROP INDEX `AiProfile_userId_idx`;
ALTER TABLE `AiProfile` ADD `jutsuLoadoutId` varchar(191);
ALTER TABLE `JutsuLoadout` ADD `customAi` boolean DEFAULT false NOT NULL;
ALTER TABLE `AiProfile` ADD CONSTRAINT `AiProfile_jutsuLoadoutId_key` UNIQUE(`jutsuLoadoutId`);
CREATE INDEX `AiProfile_userId_idx` ON `AiProfile` (`userId`);
-- The fills below touch only rows still unlinked, and players who have not chosen rules per
-- loadout yet, so running them again after the deploy links rows the previous build created in
-- between without undoing choices made with the new build.
-- A player pointing at the Default profile by name fights with it through no pointer at all.
UPDATE `UserData` SET `aiProfileId` = NULL WHERE `isAi` = 0 AND `aiProfileId` = 'Default';
-- Each player's own rules belong to their active jutsu loadout, or to their first one when no
-- loadout is active yet. When a player owns several rows, the one they fight with is kept.
UPDATE `AiProfile`
JOIN (
  SELECT `UserData`.`userId`,
    COALESCE(
      MAX(CASE WHEN `owned`.`id` = `UserData`.`aiProfileId` THEN `owned`.`id` END),
      MIN(`owned`.`id`)
    ) AS `profileId`,
    COALESCE(
      (SELECT `active`.`id` FROM `JutsuLoadout` AS `active`
        WHERE `active`.`id` = `UserData`.`jutsuLoadout` AND `active`.`userId` = `UserData`.`userId`),
      (SELECT `first`.`id` FROM `JutsuLoadout` AS `first`
        WHERE `first`.`userId` = `UserData`.`userId`
        ORDER BY `first`.`createdAt`, `first`.`id` LIMIT 1)
    ) AS `loadoutId`
  FROM `UserData`
  JOIN `AiProfile` AS `owned` ON `owned`.`userId` = `UserData`.`userId` AND `owned`.`id` <> 'Default'
  WHERE `UserData`.`isAi` = 0
  GROUP BY `UserData`.`userId`, `UserData`.`aiProfileId`, `UserData`.`jutsuLoadout`
) AS `pick` ON `pick`.`profileId` = `AiProfile`.`id`
LEFT JOIN (
  SELECT `jutsuLoadoutId` FROM `AiProfile` WHERE `jutsuLoadoutId` IS NOT NULL
) AS `taken` ON `taken`.`jutsuLoadoutId` = `pick`.`loadoutId`
SET `AiProfile`.`jutsuLoadoutId` = `pick`.`loadoutId`
WHERE `AiProfile`.`jutsuLoadoutId` IS NULL AND `pick`.`loadoutId` IS NOT NULL
  AND `taken`.`jutsuLoadoutId` IS NULL;
-- A player fighting with their own rules keeps fighting with them on every loadout: each other
-- loadout gets a copy.
INSERT INTO `AiProfile` (`id`, `userId`, `jutsuLoadoutId`, `rules`, `includeDefaultRules`)
SELECT CONCAT(`AiProfile`.`id`, '-', `JutsuLoadout`.`id`), `AiProfile`.`userId`,
  `JutsuLoadout`.`id`, `AiProfile`.`rules`, `AiProfile`.`includeDefaultRules`
FROM `UserData`
JOIN `AiProfile` ON `AiProfile`.`id` = `UserData`.`aiProfileId`
  AND `AiProfile`.`userId` = `UserData`.`userId` AND `AiProfile`.`jutsuLoadoutId` IS NOT NULL
JOIN `JutsuLoadout` ON `JutsuLoadout`.`userId` = `UserData`.`userId`
WHERE `UserData`.`isAi` = 0
  AND NOT EXISTS (
    SELECT 1 FROM `AiProfile` AS `existing` WHERE `existing`.`jutsuLoadoutId` = `JutsuLoadout`.`id`
  )
  AND NOT EXISTS (
    SELECT 1 FROM `JutsuLoadout` AS `chosen`
    WHERE `chosen`.`userId` = `UserData`.`userId` AND `chosen`.`customAi` = true
  );
-- Those loadouts fight with their own rules.
UPDATE `JutsuLoadout`
JOIN `UserData` ON `UserData`.`userId` = `JutsuLoadout`.`userId` AND `UserData`.`isAi` = 0
JOIN `AiProfile` AS `current` ON `current`.`id` = `UserData`.`aiProfileId`
  AND `current`.`userId` = `UserData`.`userId` AND `current`.`jutsuLoadoutId` IS NOT NULL
JOIN `AiProfile` AS `own` ON `own`.`jutsuLoadoutId` = `JutsuLoadout`.`id`
LEFT JOIN (
  SELECT DISTINCT `userId` FROM `JutsuLoadout` WHERE `customAi` = true
) AS `chosen` ON `chosen`.`userId` = `JutsuLoadout`.`userId`
SET `JutsuLoadout`.`customAi` = true
WHERE `JutsuLoadout`.`customAi` = false AND `chosen`.`userId` IS NULL;
-- A player who fights with custom rules on an active loadout that has none, such as a slot the
-- previous build added and switched to, keeps fighting with them: that loadout gets a copy.
INSERT INTO `AiProfile` (`id`, `userId`, `jutsuLoadoutId`, `rules`, `includeDefaultRules`)
SELECT CONCAT(`AiProfile`.`id`, '-', `JutsuLoadout`.`id`), `UserData`.`userId`,
  `JutsuLoadout`.`id`, `AiProfile`.`rules`, `AiProfile`.`includeDefaultRules`
FROM `UserData`
JOIN `JutsuLoadout` ON `JutsuLoadout`.`id` = `UserData`.`jutsuLoadout`
  AND `JutsuLoadout`.`userId` = `UserData`.`userId`
JOIN `AiProfile` ON `AiProfile`.`id` = `UserData`.`aiProfileId`
  AND `AiProfile`.`userId` = `UserData`.`userId`
WHERE `UserData`.`isAi` = 0
  AND NOT EXISTS (
    SELECT 1 FROM `AiProfile` AS `existing` WHERE `existing`.`jutsuLoadoutId` = `JutsuLoadout`.`id`
  );
-- A player's rules pointer names their active loadout's own rules when they fight with custom
-- rules, which the previous build did not keep when it switched loadouts. It runs last, keeps
-- the player's choice between custom and Default rules for the active loadout, and changes
-- nothing for players whose pointer already follows their loadout.
UPDATE `UserData`
JOIN `JutsuLoadout` ON `JutsuLoadout`.`id` = `UserData`.`jutsuLoadout`
  AND `JutsuLoadout`.`userId` = `UserData`.`userId`
LEFT JOIN `AiProfile` ON `AiProfile`.`jutsuLoadoutId` = `JutsuLoadout`.`id`
  AND `AiProfile`.`userId` = `UserData`.`userId`
SET `JutsuLoadout`.`customAi` = (`UserData`.`aiProfileId` IS NOT NULL AND `AiProfile`.`id` IS NOT NULL),
  `UserData`.`aiProfileId` = IF(`UserData`.`aiProfileId` IS NOT NULL, `AiProfile`.`id`, NULL)
WHERE `UserData`.`isAi` = 0;
