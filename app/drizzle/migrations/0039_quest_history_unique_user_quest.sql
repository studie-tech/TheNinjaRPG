-- Restore the uniqueUserIdQuestId constraint on QuestHistory.
--
-- schema.ts has declared it since 0000, but the deployed database does not have
-- it: only PRIMARY(id) is unique there. Every upsert keyed on (userId, questId)
-- -- upsertQuestEntry's insert branch, upsertQuestEntries' bulk insert, the
-- completion row created in commitQuestObjectiveRewards -- therefore inserts a
-- second row instead of updating the existing one, and reads go through
-- findFirst, so which of the rows a request sees is arbitrary.
--
-- The constraint cannot be added until the table holds one row per pair.

-- Lifetime counters gate availability (isAvailableUserQuests compares them to
-- maxCompletes/maxAttempts), and they were split across the duplicates. Lift the
-- highest value in each group onto every row of that group so the survivor keeps
-- it. MAX rather than SUM: summing could push a player past maxAttempts and lock
-- them out of a quest they can play today.
UPDATE `QuestHistory` AS `h`
JOIN (
    SELECT `userId`, `questId`,
           MAX(`previousCompletes`) AS `keepCompletes`,
           MAX(`previousAttempts`) AS `keepAttempts`
    FROM `QuestHistory`
    GROUP BY `userId`, `questId`
    HAVING COUNT(*) > 1
  ) AS `d`
  ON `d`.`userId` = `h`.`userId` AND `d`.`questId` = `h`.`questId`
SET `h`.`previousCompletes` = `d`.`keepCompletes`,
    `h`.`previousAttempts` = `d`.`keepAttempts`;
--> statement-breakpoint
-- Keep one row per pair: an attempt that is still open wins, so a quest a player
-- is part way through stays playable; otherwise the most recently started one.
-- The id breaks ties so the choice is deterministic on a rerun.
--
-- The winner is picked with MAX over a sortable string rather than ROW_NUMBER so
-- the statement needs nothing beyond grouping and string functions. Ordering the
-- period columns alongside it would let periodCompletes and periodStartAt come
-- from different rows, so those stay whole on whichever row survives.
DELETE FROM `QuestHistory`
WHERE `id` IN (
  SELECT `id` FROM (
    SELECT `h`.`id`
    FROM `QuestHistory` AS `h`
    JOIN (
        SELECT `userId`, `questId`,
               SUBSTRING_INDEX(
                 MAX(CONCAT(
                   IF(`completed` = 0 AND `endedAt` IS NULL, '1', '0'),
                   DATE_FORMAT(`startedAt`, '%Y%m%d%H%i%s%f'),
                   '|', `id`
                 )),
                 '|', -1
               ) AS `keepId`
        FROM `QuestHistory`
        GROUP BY `userId`, `questId`
        HAVING COUNT(*) > 1
      ) AS `k`
      ON `k`.`userId` = `h`.`userId` AND `k`.`questId` = `h`.`questId`
    WHERE `h`.`id` <> `k`.`keepId`
  ) AS `losers`
);
--> statement-breakpoint
ALTER TABLE `QuestHistory` ADD CONSTRAINT `uniqueUserIdQuestId` UNIQUE(`userId`,`questId`);
