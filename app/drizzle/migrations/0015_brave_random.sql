-- Preserve scheduled boosts that are already active at migration time. Future
-- scheduled boosts are refunded below because the template scheduler cannot
-- replay one-off rows after this table is dropped.
UPDATE `Village` v
JOIN (
  SELECT `villageId`, MAX(`endAt`) AS `endAt`
  FROM `ShrineBoostSchedule`
  WHERE `boostType` = 'Training'
    AND `startAt` <= CURRENT_TIMESTAMP(3)
    AND `endAt` > CURRENT_TIMESTAMP(3)
  GROUP BY `villageId`
) s ON s.`villageId` = v.`id`
SET v.`shrineSettings` = JSON_SET(
  JSON_SET(
    COALESCE(v.`shrineSettings`, JSON_OBJECT()),
    '$.activeBoosts',
    COALESCE(JSON_EXTRACT(v.`shrineSettings`, '$.activeBoosts'), JSON_OBJECT())
  ),
  '$.activeBoosts.Training',
  CONCAT(
    DATE_FORMAT(s.`endAt`, '%Y-%m-%dT%H:%i:%s.'),
    LEFT(DATE_FORMAT(s.`endAt`, '%f'), 3),
    'Z'
  )
);

UPDATE `Village` v
JOIN (
  SELECT `villageId`, MAX(`endAt`) AS `endAt`
  FROM `ShrineBoostSchedule`
  WHERE `boostType` = 'PVP'
    AND `startAt` <= CURRENT_TIMESTAMP(3)
    AND `endAt` > CURRENT_TIMESTAMP(3)
  GROUP BY `villageId`
) s ON s.`villageId` = v.`id`
SET v.`shrineSettings` = JSON_SET(
  JSON_SET(
    COALESCE(v.`shrineSettings`, JSON_OBJECT()),
    '$.activeBoosts',
    COALESCE(JSON_EXTRACT(v.`shrineSettings`, '$.activeBoosts'), JSON_OBJECT())
  ),
  '$.activeBoosts.PVP',
  CONCAT(
    DATE_FORMAT(s.`endAt`, '%Y-%m-%dT%H:%i:%s.'),
    LEFT(DATE_FORMAT(s.`endAt`, '%f'), 3),
    'Z'
  )
);

UPDATE `Village` v
JOIN (
  SELECT `villageId`, MAX(`endAt`) AS `endAt`
  FROM `ShrineBoostSchedule`
  WHERE `boostType` = 'Mission'
    AND `startAt` <= CURRENT_TIMESTAMP(3)
    AND `endAt` > CURRENT_TIMESTAMP(3)
  GROUP BY `villageId`
) s ON s.`villageId` = v.`id`
SET v.`shrineSettings` = JSON_SET(
  JSON_SET(
    COALESCE(v.`shrineSettings`, JSON_OBJECT()),
    '$.activeBoosts',
    COALESCE(JSON_EXTRACT(v.`shrineSettings`, '$.activeBoosts'), JSON_OBJECT())
  ),
  '$.activeBoosts.Mission',
  CONCAT(
    DATE_FORMAT(s.`endAt`, '%Y-%m-%dT%H:%i:%s.'),
    LEFT(DATE_FORMAT(s.`endAt`, '%f'), 3),
    'Z'
  )
);

UPDATE `Village` v
JOIN (
  SELECT `villageId`, MAX(`endAt`) AS `endAt`
  FROM `ShrineBoostSchedule`
  WHERE `boostType` = 'Errands'
    AND `startAt` <= CURRENT_TIMESTAMP(3)
    AND `endAt` > CURRENT_TIMESTAMP(3)
  GROUP BY `villageId`
) s ON s.`villageId` = v.`id`
SET v.`shrineSettings` = JSON_SET(
  JSON_SET(
    COALESCE(v.`shrineSettings`, JSON_OBJECT()),
    '$.activeBoosts',
    COALESCE(JSON_EXTRACT(v.`shrineSettings`, '$.activeBoosts'), JSON_OBJECT())
  ),
  '$.activeBoosts.Errands',
  CONCAT(
    DATE_FORMAT(s.`endAt`, '%Y-%m-%dT%H:%i:%s.'),
    LEFT(DATE_FORMAT(s.`endAt`, '%f'), 3),
    'Z'
  )
);

UPDATE `Village` v
JOIN (
  SELECT `villageId`, MAX(`endAt`) AS `endAt`
  FROM `ShrineBoostSchedule`
  WHERE `boostType` = 'Crafting'
    AND `startAt` <= CURRENT_TIMESTAMP(3)
    AND `endAt` > CURRENT_TIMESTAMP(3)
  GROUP BY `villageId`
) s ON s.`villageId` = v.`id`
SET v.`shrineSettings` = JSON_SET(
  JSON_SET(
    COALESCE(v.`shrineSettings`, JSON_OBJECT()),
    '$.activeBoosts',
    COALESCE(JSON_EXTRACT(v.`shrineSettings`, '$.activeBoosts'), JSON_OBJECT())
  ),
  '$.activeBoosts.Crafting',
  CONCAT(
    DATE_FORMAT(s.`endAt`, '%Y-%m-%dT%H:%i:%s.'),
    LEFT(DATE_FORMAT(s.`endAt`, '%f'), 3),
    'Z'
  )
);

-- Scheduled boosts were paid when they were created. Refund pending one-off
-- boosts that the new weekly template scheduler will never activate.
UPDATE `Village` v
JOIN (
  SELECT `villageId`, COUNT(*) AS `pendingBoostCount`
  FROM `ShrineBoostSchedule`
  WHERE `startAt` > CURRENT_TIMESTAMP(3)
  GROUP BY `villageId`
) s ON s.`villageId` = v.`id`
SET v.`tokens` = v.`tokens` + (s.`pendingBoostCount` * 15000);

DROP TABLE `ShrineBoostSchedule`;
