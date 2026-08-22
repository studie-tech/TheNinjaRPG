-- Repoint the "Road to Genin" graduation objectives at the post-remap village
-- sectors.
--
-- 0021_relocate_world_landmarks.sql moved the five main villages but only
-- rewrote `Village`, `Sector` and `UserData` — quest content was left alone. The
-- five `move_to_location` objectives that send a fresh Genin home therefore
-- still name the pre-remap sectors, and `isObjectiveLocationSatisfied`
-- (app/src/libs/quest.ts) compares sector + latitude + longitude exactly, so
-- those objectives can never complete. None of them carries an
-- `overworldPlacementId`, so there is no placement fallback either.
--
--   objective | village    | old | new
--   ----------|------------|-----|------
--   pBq1F     | Akikaze    | 271 |  724
--   dHuAY     | Shirohana  |  83 | 1538
--   IhGF0     | Tsukimori  | 305 | 1490
--   k3Joa     | Hyorin     | 203 |  177
--   lhFP_     | Akasumi    | 254 | 1335
--
-- Latitude/longitude (9, 13) are unchanged — only the sector moved. Each
-- statement is guarded on the quest id, the objective id at that array index
-- and the exact stale sector value, so it is idempotent and becomes a no-op if
-- the objective list is ever reordered or already corrected.

UPDATE `Quest` SET `content` = JSON_SET(`content`, '$.objectives[16].sector', 724)
WHERE `id` = '9-t1rNWEzXbIfdUfxWrny'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[16].id')) = 'pBq1F'
  AND JSON_EXTRACT(`content`, '$.objectives[16].sector') = 271;--> statement-breakpoint

UPDATE `Quest` SET `content` = JSON_SET(`content`, '$.objectives[17].sector', 1538)
WHERE `id` = '9-t1rNWEzXbIfdUfxWrny'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[17].id')) = 'dHuAY'
  AND JSON_EXTRACT(`content`, '$.objectives[17].sector') = 83;--> statement-breakpoint

UPDATE `Quest` SET `content` = JSON_SET(`content`, '$.objectives[18].sector', 1490)
WHERE `id` = '9-t1rNWEzXbIfdUfxWrny'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[18].id')) = 'IhGF0'
  AND JSON_EXTRACT(`content`, '$.objectives[18].sector') = 305;--> statement-breakpoint

UPDATE `Quest` SET `content` = JSON_SET(`content`, '$.objectives[19].sector', 177)
WHERE `id` = '9-t1rNWEzXbIfdUfxWrny'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[19].id')) = 'k3Joa'
  AND JSON_EXTRACT(`content`, '$.objectives[19].sector') = 203;--> statement-breakpoint

UPDATE `Quest` SET `content` = JSON_SET(`content`, '$.objectives[20].sector', 1335)
WHERE `id` = '9-t1rNWEzXbIfdUfxWrny'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[20].id')) = 'lhFP_'
  AND JSON_EXTRACT(`content`, '$.objectives[20].sector') = 254;
