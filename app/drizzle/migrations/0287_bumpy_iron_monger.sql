ALTER TABLE `VillageStructure` ADD `showInVillagePage` boolean DEFAULT true NOT NULL;

-- Add Academy structure to all villages except Horizon (which already has it)
INSERT INTO `VillageStructure` (`id`, `showInVillagePage`, `name`, `image`, `villageId`, `level`, `maxLevel`, `curSp`, `maxSp`, `longitude`, `latitude`, `hasPage`, `anbuSquadsPerLvl`, `arenaRewardPerLvl`, `bankInterestPerLvl`, `blackDiscountPerLvl`, `clansPerLvl`, `hospitalSpeedupPerLvl`, `itemDiscountPerLvl`, `ramenDiscountPerLvl`, `regenIncreasePerLvl`, `sleepRegenPerLvl`, `structureDiscountPerLvl`, `trainBoostPerLvl`, `villageDefencePerLvl`, `patrolsPerLvl`, `baseCost`, `allyAccess`, `route`, `lastUpgradedAt`)
VALUES
	-- Current Village Academy
	('academy_current_001', 0, 'Academy', 'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJCBmyvy26OYrIJuNP1pvSyz29edFtKbngjRcA', '_J6H3PpJrQQB8NnpbYUlW', 1, 10, 100, 100, 11, 10, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 10000, 1, '/academy', '2025-01-15 12:00:00.000'),

	-- Glacier Village Academy
	('academy_glacier_001', 0, 'Academy', 'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJCBmyvy26OYrIJuNP1pvSyz29edFtKbngjRcA', '9FZf8b9E7tZJZTaChmhHB', 1, 10, 100, 100, 11, 10, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 10000, 1, '/academy', '2025-01-15 12:00:00.000'),

	-- Tsukimori Village Academy
	('academy_tsukimori_001', 0, 'Academy', 'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJCBmyvy26OYrIJuNP1pvSyz29edFtKbngjRcA', 'clh4d6sha0018tb0hrer16kv5', 1, 10, 100, 100, 11, 10, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 10000, 1, '/academy', '2025-01-15 12:00:00.000'),

	-- Shroud Village Academy
	('academy_shroud_001', 0, 'Academy', 'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJCBmyvy26OYrIJuNP1pvSyz29edFtKbngjRcA', 'fofe-im05F7BJsI6Szn87', 1, 10, 100, 100, 11, 10, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 10000, 1, '/academy', '2025-01-15 12:00:00.000'),

	-- Shine Village Academy
	('academy_shine_001', 0, 'Academy', 'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJCBmyvy26OYrIJuNP1pvSyz29edFtKbngjRcA', 'GQhLjH7uMMe0jN1qXzM7B', 1, 10, 100, 100, 11, 10, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 10000, 1, '/academy', '2025-01-15 12:00:00.000'),

	-- Syndicate Academy (OUTLAW village)
	('academy_syndicate_001', 0, 'Academy', 'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJCBmyvy26OYrIJuNP1pvSyz29edFtKbngjRcA', 'ryBk0qD4EgvPPyav2K4OC', 1, 10, 100, 100, 11, 10, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 10000, 1, '/academy', '2025-01-15 12:00:00.000'),

	-- Freedom State Academy
	('academy_freedom_001', 0, 'Academy', 'https://ui0arpl8sm.ufs.sh/f/Hzww9EQvYURJCBmyvy26OYrIJuNP1pvSyz29edFtKbngjRcA', 'TDSh81zWX-Vqolk2WPFZe', 1, 10, 100, 100, 11, 10, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 10000, 1, '/academy', '2025-01-15 12:00:00.000');
