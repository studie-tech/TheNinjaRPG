-- Recalibrate skill points after moving leveling rewards from levels 21-40 to 31-50.
-- Preserves non-leveling skill points (e.g. quests) by applying the delta between formulas:
--   old: LEAST(GREATEST(level - 20, 0), 20)
--   new: LEAST(GREATEST(level - 30, 0), 20)
-- Intentionally allows negative skillPoints so users with spent points keep the debt
-- until the skill-tree reset refunds them to the correct final balance.
-- Narrowed to levels 21-50: outside that range both formulas clamp to the same value
-- so the delta is 0 and rewriting those rows would only add binlog/replication traffic.
UPDATE `UserData`
SET `skillPoints` = `skillPoints` + (
  LEAST(GREATEST(`level` - 30, 0), 20) - LEAST(GREATEST(`level` - 20, 0), 20)
)
WHERE `rank` IN ('CHUNIN', 'JONIN', 'ELITE JONIN', 'ELDER')
  AND `isAi` = 0
  AND `level` >= 20;
