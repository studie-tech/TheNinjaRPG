-- Clear all current battle queue data to fix duplicate user entries
-- Order matters: reset users first, then delete MpvpBattleUser (references MpvpBattleQueue), then MpvpBattleQueue

-- Reset QUEUED users who are in MpvpBattleUser to AWAKE
-- (Don't reset users who might be in RankedPvpQueue - they use QUEUED status too)
UPDATE `UserData` ud
INNER JOIN `MpvpBattleUser` mbu ON ud.userId = mbu.userId
SET ud.status = 'AWAKE'
WHERE ud.status = 'QUEUED';

-- Delete all battle user entries
DELETE FROM `MpvpBattleUser`;

-- Delete all battle queue entries
DELETE FROM `MpvpBattleQueue`;

-- Also reset any orphaned QUEUED users who are not in any queue
-- (users who are QUEUED but not in MpvpBattleUser or RankedPvpQueue)
UPDATE `UserData` ud
SET ud.status = 'AWAKE'
WHERE ud.status = 'QUEUED'
  AND NOT EXISTS (SELECT 1 FROM `RankedPvpQueue` rpq WHERE rpq.userId = ud.userId);

-- Add unique constraint to prevent user being in multiple battles at once
ALTER TABLE `MpvpBattleUser` ADD CONSTRAINT `MpvpBattleUser_userId_key` UNIQUE(`userId`);