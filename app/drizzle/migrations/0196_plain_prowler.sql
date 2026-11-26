CREATE TABLE `BloodrightOption` (
	`id` varchar(191) NOT NULL,
	`bloodlineId` varchar(191) NOT NULL,
	`jutsuId` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL,
	`description` text NOT NULL,
	`seichiSilverCost` int NOT NULL DEFAULT 0,
	`hidden` boolean NOT NULL DEFAULT true,
	`changes` json NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `BloodrightOption_id` PRIMARY KEY(`id`)
);

-- Arbitrary passive skills cannot be mapped to a single jutsu/tag enhancement.
-- Return recorded investments before retiring those definitions.
UPDATE `UserData` SET `seichiSilver` = `seichiSilver` + `bloodrightSpent`, `bloodright` = JSON_ARRAY(), `bloodrightSpent` = 0 WHERE JSON_LENGTH(`bloodright`) > 0 OR `bloodrightSpent` <> 0;
-- Retained skills must remain reachable when passive Bloodright prerequisites retire.
UPDATE `SkillTree` AS kept
CROSS JOIN (SELECT JSON_ARRAYAGG(`id`) AS ids FROM `SkillTree` WHERE `pathType` = 'BLOODRIGHT') AS retired
SET kept.`requiredSkillIds` = (
  SELECT COALESCE(JSON_ARRAYAGG(dependency.id), JSON_ARRAY())
  FROM JSON_TABLE(kept.`requiredSkillIds`, '$[*]' COLUMNS (id VARCHAR(191) PATH '$')) AS dependency
  WHERE JSON_CONTAINS(COALESCE(retired.ids, JSON_ARRAY()), JSON_QUOTE(dependency.id)) = 0
)
WHERE kept.`pathType` = 'SKILL';
DELETE `UserSkill` FROM `UserSkill` JOIN `SkillTree` ON `UserSkill`.`skillId` = `SkillTree`.`id` WHERE `SkillTree`.`pathType` = 'BLOODRIGHT';
DELETE FROM `SkillTree` WHERE `pathType` = 'BLOODRIGHT';

DROP INDEX `SkillTree_bloodlineId_idx` ON `SkillTree`;
CREATE INDEX `BloodrightOption_bloodlineId_idx` ON `BloodrightOption` (`bloodlineId`);
CREATE INDEX `BloodrightOption_jutsuId_idx` ON `BloodrightOption` (`jutsuId`);
ALTER TABLE `SkillTree` DROP COLUMN `pathType`;
ALTER TABLE `SkillTree` DROP COLUMN `bloodlineId`;
ALTER TABLE `SkillTree` DROP COLUMN `seichiSilverCost`;