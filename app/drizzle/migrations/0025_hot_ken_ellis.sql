-- Recalibrate skill points after moving leveling rewards from levels 21-40 to 31-50.
--
-- The Genin level cap changed from 20 to 30 on 2026-04-22 11:32:34 UTC. Users
-- who completed the Chunin exam before that change could earn points at levels
-- 21-40, while later cohorts remained Genin through level 30 and only earned
-- points at levels 31-40. Handle those histories separately so quest-earned
-- points are preserved.

-- Pre-cap-change Chunin cohort: replace the old 21-40 leveling component with
-- the new 31-50 component. Only levels 21-49 have a non-zero delta.
UPDATE `UserData` AS u
SET u.`skillPoints` = u.`skillPoints` + (
  LEAST(GREATEST(u.`level` - 30, 0), 20) -
  LEAST(GREATEST(u.`level` - 20, 0), 20)
)
WHERE u.`rank` IN ('CHUNIN', 'JONIN', 'ELITE JONIN', 'ELDER')
  AND u.`isAi` = 0
  AND u.`level` BETWEEN 21 AND 49
  AND EXISTS (
    SELECT 1
    FROM `QuestHistory` AS qh
    INNER JOIN `Quest` AS q ON q.`id` = qh.`questId`
    WHERE qh.`userId` = u.`userId`
      AND qh.`completed` > 0
      AND qh.`endedAt` < '2026-04-22 11:32:34'
      AND q.`questType` = 'exam'
      AND JSON_UNQUOTE(JSON_EXTRACT(q.`content`, '$.reward.reward_rank')) = 'CHUNIN'
  );--> statement-breakpoint

-- Post-cap-change (and conservatively, unclassified) cohort: levels 31-40
-- were already awarded correctly, so add only the missing levels 41-50.
-- Every selected level has a positive delta, including users now above 50.
UPDATE `UserData` AS u
SET u.`skillPoints` = LEAST(
  u.`skillPoints` + LEAST(GREATEST(u.`level` - 40, 0), 10),
  100
)
WHERE u.`rank` IN ('CHUNIN', 'JONIN', 'ELITE JONIN', 'ELDER')
  AND u.`isAi` = 0
  AND u.`level` BETWEEN 41 AND 100
  AND NOT EXISTS (
    SELECT 1
    FROM `QuestHistory` AS qh
    INNER JOIN `Quest` AS q ON q.`id` = qh.`questId`
    WHERE qh.`userId` = u.`userId`
      AND qh.`completed` > 0
      AND qh.`endedAt` < '2026-04-22 11:32:34'
      AND q.`questType` = 'exam'
      AND JSON_UNQUOTE(JSON_EXTRACT(q.`content`, '$.reward.reward_rank')) = 'CHUNIN'
  );
