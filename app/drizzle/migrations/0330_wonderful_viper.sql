-- Custom SQL migration file, put your code below! --

-- Fix users stuck in QUEUED status due to race condition in war cleanup
-- where MpvpBattleUser records were deleted before the UPDATE could reset their status.
-- Only reset users who have no MpvpBattleUser AND no RankedPvpQueue record (truly orphaned).
UPDATE UserData ud
LEFT JOIN MpvpBattleUser mbu ON ud.userId = mbu.userId
LEFT JOIN RankedPvpQueue rpq ON ud.userId = rpq.userId
SET ud.status = 'AWAKE'
WHERE ud.status = 'QUEUED'
  AND mbu.userId IS NULL
  AND rpq.userId IS NULL;

-- Reset users queued for pending shrine battles where the sector war has ended
UPDATE UserData ud
INNER JOIN MpvpBattleUser mbu ON ud.userId = mbu.userId
INNER JOIN MpvpBattleQueue mbq ON mbu.clanBattleId = mbq.id
LEFT JOIN War w ON mbq.sector = w.sector AND w.status = 'ACTIVE' AND w.type = 'SECTOR_WAR'
SET ud.status = 'AWAKE'
WHERE mbq.battleType = 'SHRINE_BATTLE'
  AND mbq.battleId IS NULL
  AND ud.status = 'QUEUED'
  AND w.id IS NULL;

-- Delete orphaned MpvpBattleUser records (where the referenced MpvpBattleQueue no longer exists)
DELETE mbu FROM MpvpBattleUser mbu
LEFT JOIN MpvpBattleQueue mbq ON mbu.clanBattleId = mbq.id
WHERE mbq.id IS NULL;

-- Delete MpvpBattleUser records for pending shrine battles where the sector war has ended
DELETE mbu FROM MpvpBattleUser mbu
INNER JOIN MpvpBattleQueue mbq ON mbu.clanBattleId = mbq.id
LEFT JOIN War w ON mbq.sector = w.sector AND w.status = 'ACTIVE' AND w.type = 'SECTOR_WAR'
WHERE mbq.battleType = 'SHRINE_BATTLE'
  AND mbq.battleId IS NULL
  AND w.id IS NULL;

-- Delete pending MpvpBattleQueue records for shrine battles where the sector war has ended
DELETE mbq FROM MpvpBattleQueue mbq
LEFT JOIN War w ON mbq.sector = w.sector AND w.status = 'ACTIVE' AND w.type = 'SECTOR_WAR'
WHERE mbq.battleType = 'SHRINE_BATTLE'
  AND mbq.battleId IS NULL
  AND w.id IS NULL;