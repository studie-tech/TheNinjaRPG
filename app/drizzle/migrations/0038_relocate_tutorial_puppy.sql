-- Move the "Getting Started" puppy from sector 293 to 227.
--
-- 293 sits 40 degrees of longitude west of Horizon (301). The globe opens
-- centred on the player, so the marker landed about two thirds of the way out
-- to the limb, edge-on, on a step that does not say the globe can be turned.
-- 227 is 10 degrees out, between Horizon and Wake Island (222), which is where
-- the new-player route already runs.
--
-- Why 227 and not the exact midpoint. Columns 9 and 10 across rows 3-4 are
-- either claimed territory (225/226 Elysium, 297 Silence) or open ocean
-- (295, 297, 298) - and the puppy's tile in 293 is ocean today, which is its
-- own small absurdity. 227 is the nearest sector to the midpoint that is
-- unowned, published, and whose tile (9,6) is walkable ground:
--
--   sector | row,col | tile (9,6)     | owner
--   -------|---------|----------------|-----------------
--   293    |  4,5    | ocean          | unowned   <- from
--   226    |  3,10   | ground         | Elysium
--   227    |  3,11   | ground, cost 1 | unowned   <- to
--
-- The objective keeps its (9,6) tile, which is walkable in the new sector.
-- Guarded on the id and the current value, so it is idempotent and cannot fire
-- against a quest whose objectives have since been reordered or re-pointed.
--
-- 227 is added to MAP_RESERVED_SECTORS in the same change, so shrines, wars
-- and clan hideouts cannot claim the sector out from under the tutorial.

UPDATE `Quest`
SET `content` = JSON_SET(`content`, '$.objectives[1].sector', 227)
WHERE `id` = 'eYDVpL63vPhK3lywMexdv'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[1].id')) = '_nY7o'
  AND JSON_UNQUOTE(JSON_EXTRACT(`content`, '$.objectives[1].task')) = 'defeat_opponents'
  AND JSON_EXTRACT(`content`, '$.objectives[1].sector') = 293;
--> statement-breakpoint
-- Players who already started the quest carry their own copy of the location.
-- UserData.questData snapshots sector/latitude/longitude per goal when a quest
-- begins, and controlShownQuestLocationInformation() lets that snapshot win over
-- the quest definition -- so moving the quest alone would leave every player
-- mid-tutorial staring at a marker on 293 while the travel guard, reading
-- TUTORIAL_CAPTURE_SECTOR, demanded 227. That is a soft-lock, and on production
-- it is ~25k accounts.
--
-- The goal's index inside the tracker varies per player, so the path is derived
-- per row: JSON_SEARCH finds "$[i].goals[j].id" for the objective, and trimming
-- the trailing "id" gives the sibling "sector" to write. Guarded on the current
-- value, so it is idempotent and cannot touch a tracker already moved or one
-- carrying a location this quest never had.
--
-- The (9,6) tile is unchanged and walkable in 227, so latitude/longitude in the
-- snapshot stay correct as they are.

UPDATE `UserData`
SET `questData` = JSON_SET(
      `questData`,
      CONCAT(
        LEFT(
          JSON_UNQUOTE(JSON_SEARCH(`questData`, 'one', '_nY7o', NULL, '$[*].goals[*].id')),
          CHAR_LENGTH(JSON_UNQUOTE(JSON_SEARCH(`questData`, 'one', '_nY7o', NULL, '$[*].goals[*].id'))) - 2
        ),
        'sector'
      ),
      227
    )
WHERE JSON_SEARCH(`questData`, 'one', '_nY7o', NULL, '$[*].goals[*].id') IS NOT NULL
  AND JSON_EXTRACT(
        `questData`,
        CONCAT(
          LEFT(
            JSON_UNQUOTE(JSON_SEARCH(`questData`, 'one', '_nY7o', NULL, '$[*].goals[*].id')),
            CHAR_LENGTH(JSON_UNQUOTE(JSON_SEARCH(`questData`, 'one', '_nY7o', NULL, '$[*].goals[*].id'))) - 2
          ),
          'sector'
        )
      ) = 293;
