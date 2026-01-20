-- Custom SQL migration file, put your code below! --

-- Fix users stuck in QUEUED status due to race condition in war cleanup
-- where MpvpBattleUser records were deleted before the UPDATE could reset their status.
-- These users have status = 'QUEUED' but no corresponding MpvpBattleUser record.
UPDATE UserData ud
LEFT JOIN MpvpBattleUser mbu ON ud.userId = mbu.userId
SET ud.status = 'AWAKE'
WHERE ud.status = 'QUEUED'
  AND mbu.userId IS NULL;