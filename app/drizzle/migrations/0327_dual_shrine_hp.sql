-- Migration: Dual Shrine HP System
-- Adds separate attacker and defender shrine HP and status fields for Village Wars/Raids

-- Step 1: Add new columns with defaults
ALTER TABLE `War` ADD COLUMN `attackerShrineHp` smallint NOT NULL DEFAULT 1000;
ALTER TABLE `War` ADD COLUMN `attackerShrineMaxHp` smallint NOT NULL DEFAULT 1000;
ALTER TABLE `War` ADD COLUMN `attackerShrineStatus` enum('ACTIVE','CAPTURED') NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE `War` ADD COLUMN `defenderShrineHp` smallint NOT NULL DEFAULT 100;
ALTER TABLE `War` ADD COLUMN `defenderShrineMaxHp` smallint NOT NULL DEFAULT 100;
ALTER TABLE `War` ADD COLUMN `defenderShrineStatus` enum('ACTIVE','CAPTURED') NOT NULL DEFAULT 'ACTIVE';

-- Step 2: Migrate existing data
-- Copy old shrineHp to defenderShrineHp for SECTOR_WAR (level-based shrines)
UPDATE `War` SET `defenderShrineHp` = `shrineHp`, `defenderShrineMaxHp` = `shrineMaxHp` WHERE `type` = 'SECTOR_WAR';

-- For SECTOR_WAR: Set attacker shrine to 0 (no attacker shrine)
UPDATE `War` SET `attackerShrineHp` = 0, `attackerShrineMaxHp` = 0, `attackerShrineStatus` = 'CAPTURED' WHERE `type` = 'SECTOR_WAR';

-- For SECTOR_WAR: Set defender status to CAPTURED if HP was depleted
UPDATE `War` SET `defenderShrineStatus` = 'CAPTURED' WHERE `type` = 'SECTOR_WAR' AND `defenderShrineHp` <= 0;

-- For VILLAGE_WAR and WAR_RAID: Normalize both shrines to fixed 1000 HP values
UPDATE `War` SET 
  `attackerShrineHp` = 1000, 
  `attackerShrineMaxHp` = 1000, 
  `attackerShrineStatus` = 'ACTIVE',
  `defenderShrineHp` = 1000, 
  `defenderShrineMaxHp` = 1000, 
  `defenderShrineStatus` = 'ACTIVE'
WHERE `type` IN ('VILLAGE_WAR', 'WAR_RAID');

-- Step 3: Drop old columns
ALTER TABLE `War` DROP COLUMN `shrineHp`;
ALTER TABLE `War` DROP COLUMN `shrineMaxHp`;
