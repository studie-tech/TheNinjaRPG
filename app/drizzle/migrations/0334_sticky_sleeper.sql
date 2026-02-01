CREATE TABLE `SkillTreeFolder` (
	`id` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL,
	`image` varchar(512) NOT NULL DEFAULT '',
	`description` text,
	`hidden` boolean NOT NULL DEFAULT false,
	`order` int NOT NULL DEFAULT 0,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `SkillTreeFolder_id` PRIMARY KEY(`id`)
);

ALTER TABLE `SkillTree` ADD `folderId` varchar(191);
CREATE INDEX `SkillTreeFolder_name_idx` ON `SkillTreeFolder` (`name`);
CREATE INDEX `SkillTreeFolder_order_idx` ON `SkillTreeFolder` (`order`);
CREATE INDEX `SkillTreeFolder_hidden_idx` ON `SkillTreeFolder` (`hidden`);
CREATE INDEX `SkillTree_folderId_idx` ON `SkillTree` (`folderId`);

-- Create skill tree folders for organization
INSERT INTO `SkillTreeFolder` (`id`, `name`, `image`, `description`, `hidden`, `order`, `createdAt`, `updatedAt`) VALUES
('folder-offense', 'Offense Specialization', 'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJ1gj9zL6bo95WClq4K0wxZUmJcvThgdVenO3P', 'Unlock offensive stat bonuses and damage reduction', false, 1, NOW(3), NOW(3)),
('folder-stat-specialists', 'Stat Specialists', 'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJnQjFaidmojJ0EqeDCvBrNmZaXVdY97gSpOWi', 'Specialize in Ninjutsu, Genjutsu, Taijutsu, or Bukijutsu', false, 2, NOW(3), NOW(3)),
('folder-elemental', 'Elemental Mastery', 'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJunQY1OLCyJLoOFkrcn4gxSwCfEQ9eMNXZlG8', 'Increase or reduce elemental damage', false, 3, NOW(3), NOW(3)),
('folder-combat-utility', 'Combat Utility', 'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJgsvTfMcU9cpECTimBdjaqbNn7vQsxGR1wLk4', 'Absorb, Reflect, Life Steal, and Healing abilities', false, 4, NOW(3), NOW(3)),
('folder-weapons-jutsu', 'Weapons & Jutsu', 'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJeCIZuZmyV3OvUJQExAi0bGoIZDF74LqSnHRd', 'Weapon damage and jutsu cost reduction', false, 5, NOW(3), NOW(3)),
('folder-defense', 'Defense', 'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJDytvqNozEwoh0WXMnscL279N8ayVQUCbRzS3', 'Defensive stat increases and damage mitigation', false, 6, NOW(3), NOW(3));

-- Assign skills to folders based on their effects

-- Offense Specialization folder
UPDATE `SkillTree` SET `folderId` = 'folder-offense' WHERE `id` = 'mTHDRIQkWsGv_GqpqM1AX';

-- Stat Specialists folder (Bukijutsu, Genjutsu, Taijutsu, Ninjutsu specialists)
UPDATE `SkillTree` SET `folderId` = 'folder-stat-specialists' WHERE `id` IN (
  'KKdv9_ux99hH3kr4CorWP',
  'gW1ag32eMxYa1XJ5RcQPc',
  'eJhSq5du7-cU1nA2-MNxQ',
  '9VwZALoIEunl0YI3osX-w',
  'ISJIDlcz812cJSSYV-qQ-',
  '3zlRaod7Y1dZ_qt1Zkk5J',
  '8LZZKuyWTLccGFtXB9Dud',
  '6gK4li_pFBAFaUeRCAPq-'
);

-- Elemental Mastery folder
UPDATE `SkillTree` SET `folderId` = 'folder-elemental' WHERE `id` IN (
  '5LGbIr_jRio0uiltrR0or',
  '2t5F5Jqq6Uf9f28LFeV5a',
  'eB4E7MhfwTbq-WV_tAksp',
  'fQNhYOmiUUWBsKJz-m2fj',
  'rnswzfywW5iCvkXagFEj4'
);

-- Combat Utility folder (Absorb, Reflect, Life Steal, Heal)
UPDATE `SkillTree` SET `folderId` = 'folder-combat-utility' WHERE `id` IN (
  'VXPjEojxVrIadOhbC7FAA',
  'wIQl0MQH-R9n_TUbYcG9U',
  'x21y1V7d47RT1dVQaNQmi',
  'Qi4ffE72-w5F811QpnLmw',
  'rOLGAfihuSHXdltUc3wXK'
);

-- Weapons & Jutsu folder
UPDATE `SkillTree` SET `folderId` = 'folder-weapons-jutsu' WHERE `id` IN (
  'mqi3gkzcx8AFAvaB5Xpgm',
  'z5aeH4yZa4ZOk3OlCsqT1'
);

-- Defense folder
UPDATE `SkillTree` SET `folderId` = 'folder-defense' WHERE `id` = 'GgxxApe2BCSi3REGh16GO';

-- Assign any remaining skills without a folder to a General folder
INSERT INTO `SkillTreeFolder` (`id`, `name`, `image`, `description`, `hidden`, `order`, `createdAt`, `updatedAt`) VALUES
('folder-general', 'General', '', 'Uncategorized skills', false, 0, NOW(3), NOW(3));

UPDATE `SkillTree` SET `folderId` = 'folder-general' WHERE `folderId` IS NULL;