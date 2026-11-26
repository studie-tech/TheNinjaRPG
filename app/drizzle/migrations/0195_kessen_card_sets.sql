-- Kessen cards name their synergy in one `sets` list: a card's sets are its former summon
-- groups plus the groups its Bond abilities name, preserving every set membership and
-- Summon pool. Bond counts set members under rules version 4; active matches on earlier
-- rules retire through the engine-version guard. Card items and stored match snapshots
-- (the engine's cards and NPC pool) move to the new field. JSON aggregation leaves element
-- order undefined, so the pool, whose order is stored, is rebuilt by index. JSON_TABLE reads
-- only base-table and earlier JSON_TABLE columns, never a CTE's, so the set rows unpack
-- the match state itself.
-- CTEs belong to derived SELECTs: PlanetScale/Vitess rejects WITH on UPDATE itself.
-- Binary collation preserves the case and accents the engine matches by exact set name.
UPDATE `Item` AS `card`
LEFT JOIN (
WITH `cardSet` AS (
  SELECT `card`.`id`, `summoned`.`name`
  FROM `Item` AS `card`,
    JSON_TABLE(`card`.`cardData`, '$.summonGroups[*]' COLUMNS (`name` VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PATH '$')) AS `summoned`
  WHERE `card`.`itemType` = 'CARD'
  UNION
  SELECT `card`.`id`, `ability`.`name`
  FROM `Item` AS `card`,
    JSON_TABLE(`card`.`cardData`, '$.abilities[*]' COLUMNS (
      `kind` VARCHAR(32) PATH '$.k',
      `name` VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PATH '$.group'
    )) AS `ability`
  WHERE `card`.`itemType` = 'CARD' AND `ability`.`kind` = 'bond'
),
`cardSets` AS (
  SELECT `id`, JSON_ARRAYAGG(`name`) AS `sets` FROM `cardSet` GROUP BY `id`
)
SELECT * FROM `cardSets`
) AS `cardSets` ON `cardSets`.`id` = `card`.`id`
SET `card`.`cardData` = JSON_REMOVE(
  JSON_SET(`card`.`cardData`, '$.sets', COALESCE(`cardSets`.`sets`, JSON_ARRAY())),
  '$.summonGroups'
)
WHERE `card`.`itemType` = 'CARD'
  AND JSON_TYPE(`card`.`cardData`) = 'OBJECT'
  AND NOT JSON_CONTAINS_PATH(`card`.`cardData`, 'one', '$.sets');

UPDATE `KessenMatch` AS `kessen`
JOIN (
WITH `matchCard` AS (
  SELECT `kessen`.`id` AS `matchId`, `entry`.`cardId`,
    JSON_EXTRACT(`kessen`.`state`, CONCAT('$.engine.cards.', JSON_QUOTE(`entry`.`cardId`))) AS `doc`
  FROM `KessenMatch` AS `kessen`,
    JSON_TABLE(JSON_KEYS(`kessen`.`state`, '$.engine.cards'), '$[*]' COLUMNS (
      `cardId` VARCHAR(191) PATH '$'
    )) AS `entry`
  WHERE JSON_CONTAINS_PATH(`kessen`.`state`, 'one', '$.engine.cards.*.summonGroups')
),
`matchCardSet` AS (
  SELECT DISTINCT `kessen`.`id` AS `matchId`, `entry`.`cardId`,
    COALESCE(`card`.`summoned`, IF(`card`.`kind` = 'bond', `card`.`bond`, NULL)) AS `name`
  FROM `KessenMatch` AS `kessen`,
    JSON_TABLE(JSON_KEYS(`kessen`.`state`, '$.engine.cards'), '$[*]' COLUMNS (
      `cardId` VARCHAR(191) PATH '$'
    )) AS `entry`,
    JSON_TABLE(
      JSON_EXTRACT(`kessen`.`state`, CONCAT('$.engine.cards.', JSON_QUOTE(`entry`.`cardId`))),
      '$' COLUMNS (
        NESTED PATH '$.summonGroups[*]' COLUMNS (`summoned` VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PATH '$'),
        NESTED PATH '$.abilities[*]' COLUMNS (
          `kind` VARCHAR(32) PATH '$.k',
          `bond` VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PATH '$.group'
        )
      )
    ) AS `card`
  WHERE JSON_CONTAINS_PATH(`kessen`.`state`, 'one', '$.engine.cards.*.summonGroups')
    AND (`card`.`summoned` IS NOT NULL OR `card`.`kind` = 'bond')
),
`matchCardSets` AS (
  SELECT `matchId`, `cardId`, JSON_ARRAYAGG(`name`) AS `sets`
  FROM `matchCardSet`
  GROUP BY `matchId`, `cardId`
),
`matchCards` AS (
  SELECT `matchCard`.`matchId`, JSON_OBJECTAGG(
    `matchCard`.`cardId`,
    IF(JSON_CONTAINS_PATH(`matchCard`.`doc`, 'one', '$.sets'), `matchCard`.`doc`,
      JSON_REMOVE(
        JSON_SET(`matchCard`.`doc`, '$.sets', COALESCE(`matchCardSets`.`sets`, JSON_ARRAY())),
        '$.summonGroups'
      )
    )
  ) AS `cards`
  FROM `matchCard`
  LEFT JOIN `matchCardSets` ON `matchCardSets`.`matchId` = `matchCard`.`matchId`
    AND `matchCardSets`.`cardId` = `matchCard`.`cardId`
  GROUP BY `matchCard`.`matchId`
)
SELECT * FROM `matchCards`
) AS `matchCards` ON `matchCards`.`matchId` = `kessen`.`id`
SET `kessen`.`state` = JSON_SET(`kessen`.`state`, '$.engine.cards', `matchCards`.`cards`);

UPDATE `KessenMatch` AS `kessen`
JOIN (
WITH RECURSIVE `poolCard` AS (
  SELECT `kessen`.`id` AS `matchId`, `entry`.`n`, `entry`.`doc`
  FROM `KessenMatch` AS `kessen`,
    JSON_TABLE(`kessen`.`state`, '$.pool[*]' COLUMNS (
      `n` FOR ORDINALITY,
      `doc` JSON PATH '$'
    )) AS `entry`
  WHERE JSON_CONTAINS_PATH(`kessen`.`state`, 'one', '$.pool[*].summonGroups')
),
`poolCardSet` AS (
  SELECT DISTINCT `kessen`.`id` AS `matchId`, `card`.`n`,
    COALESCE(`card`.`summoned`, IF(`card`.`kind` = 'bond', `card`.`bond`, NULL)) AS `name`
  FROM `KessenMatch` AS `kessen`,
    JSON_TABLE(`kessen`.`state`, '$.pool[*]' COLUMNS (
      `n` FOR ORDINALITY,
      NESTED PATH '$.summonGroups[*]' COLUMNS (`summoned` VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PATH '$'),
      NESTED PATH '$.abilities[*]' COLUMNS (
        `kind` VARCHAR(32) PATH '$.k',
        `bond` VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PATH '$.group'
      )
    )) AS `card`
  WHERE JSON_CONTAINS_PATH(`kessen`.`state`, 'one', '$.pool[*].summonGroups')
    AND (`card`.`summoned` IS NOT NULL OR `card`.`kind` = 'bond')
),
`poolCardSets` AS (
  SELECT `matchId`, `n`, JSON_ARRAYAGG(`name`) AS `sets`
  FROM `poolCardSet`
  GROUP BY `matchId`, `n`
),
`poolEntry` AS (
  SELECT `poolCard`.`matchId`, `poolCard`.`n`,
    IF(JSON_CONTAINS_PATH(`poolCard`.`doc`, 'one', '$.sets'), `poolCard`.`doc`,
      JSON_REMOVE(
        JSON_SET(`poolCard`.`doc`, '$.sets', COALESCE(`poolCardSets`.`sets`, JSON_ARRAY())),
        '$.summonGroups'
      )
    ) AS `doc`
  FROM `poolCard`
  LEFT JOIN `poolCardSets` ON `poolCardSets`.`matchId` = `poolCard`.`matchId`
    AND `poolCardSets`.`n` = `poolCard`.`n`
),
`rebuiltPool` (`matchId`, `n`, `pool`) AS (
  SELECT DISTINCT `matchId`, 0, JSON_ARRAY() FROM `poolCard`
  UNION ALL
  SELECT `rebuiltPool`.`matchId`, `rebuiltPool`.`n` + 1,
    JSON_ARRAY_APPEND(`rebuiltPool`.`pool`, '$', `poolEntry`.`doc`)
  FROM `rebuiltPool`
  JOIN `poolEntry` ON `poolEntry`.`matchId` = `rebuiltPool`.`matchId`
    AND `poolEntry`.`n` = `rebuiltPool`.`n` + 1
)
SELECT * FROM `rebuiltPool`
) AS `rebuiltPool` ON `rebuiltPool`.`matchId` = `kessen`.`id`
  AND `rebuiltPool`.`n` = JSON_LENGTH(`kessen`.`state`, '$.pool')
SET `kessen`.`state` = JSON_SET(`kessen`.`state`, '$.pool', `rebuiltPool`.`pool`);
