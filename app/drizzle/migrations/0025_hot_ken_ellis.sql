-- Grant skill points missed when the Chunin rank floor moved to level 30 but the
-- leveling skill-point window stayed at 21-40. Eligible players only earned points
-- on levels 31-40 (10 max) and never received levels 41-50.
--
-- Adds the missing points from the shifted window (31-50):
--   level 41 -> +1 ... level 50+ -> +10
-- Preserves non-leveling skill points (e.g. quests) by only applying this delta.
UPDATE `UserData`
SET `skillPoints` = `skillPoints` + LEAST(GREATEST(`level` - 40, 0), 10)
WHERE `rank` IN ('CHUNIN', 'JONIN', 'ELITE JONIN', 'ELDER')
  AND `isAi` = 0
  AND `level` >= 41;
