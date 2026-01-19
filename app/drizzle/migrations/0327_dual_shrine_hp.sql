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
-- Copy old shrineHp to defenderShrineHp (existing logic treated it as defender's shrine)
UPDATE `War` SET `defenderShrineHp` = `shrineHp`, `defenderShrineMaxHp` = `shrineMaxHp`;

-- For SECTOR_WAR: Set attacker shrine to 0 (no attacker shrine)
UPDATE `War` SET `attackerShrineHp` = 0, `attackerShrineMaxHp` = 0, `attackerShrineStatus` = 'CAPTURED' WHERE `type` = 'SECTOR_WAR';

-- For VILLAGE_WAR and WAR_RAID: Set attacker shrine to 1000 (full HP)
UPDATE `War` SET `attackerShrineHp` = 1000, `attackerShrineMaxHp` = 1000, `attackerShrineStatus` = 'ACTIVE' WHERE `type` IN ('VILLAGE_WAR', 'WAR_RAID');

-- Set defender status based on existing HP
UPDATE `War` SET `defenderShrineStatus` = 'CAPTURED' WHERE `defenderShrineHp` <= 0;

-- Step 3: Drop old columns
ALTER TABLE `War` DROP COLUMN `shrineHp`;
ALTER TABLE `War` DROP COLUMN `shrineMaxHp`;
