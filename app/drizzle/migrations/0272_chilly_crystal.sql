ALTER TABLE `SkillTree` ADD `skillType` enum('DEFAULT','SPECIAL') DEFAULT 'DEFAULT' NOT NULL;
ALTER TABLE `UserSkill` ADD `activated` boolean DEFAULT true NOT NULL;
CREATE INDEX `SkillTree_skillType_idx` ON `SkillTree` (`skillType`);