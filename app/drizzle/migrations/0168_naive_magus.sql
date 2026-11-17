-- Combat tags select unified stats by direction. Preserve general-only modifiers
-- while removing jutsu-category selectors, including cached battle templates.
-- Type paths remain stable as object properties change; arrays retain their order.

WITH RECURSIVE matches AS (
  SELECT `id`, `effects` AS document,
    JSON_SEARCH(`effects`, 'all', '%', NULL, '$**.type') AS paths
  FROM `Bloodline`
), normalized (`id`, document, paths, tagIndex) AS (
  SELECT `id`, document,
    CASE WHEN JSON_TYPE(paths) = 'STRING' THEN JSON_ARRAY(JSON_UNQUOTE(paths)) ELSE paths END, 0
  FROM matches WHERE paths IS NOT NULL
  UNION ALL
  SELECT normalized.`id`,
    JSON_REMOVE(
      CASE
        WHEN JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.type')) IN ('increasestat', 'decreasestat')
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.statTypes')), 0) = 0
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.generalTypes')), 0) > 0
        THEN JSON_SET(normalized.document, CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.direction'), 'none')
        ELSE normalized.document
      END,
      CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.statTypes')
    ), normalized.paths, normalized.tagIndex + 1
  FROM normalized
  WHERE normalized.tagIndex < JSON_LENGTH(normalized.paths)
)
UPDATE `Bloodline` AS target
JOIN normalized ON target.`id` = normalized.`id`
  AND normalized.tagIndex = JSON_LENGTH(normalized.paths)
SET target.`effects` = normalized.document;

WITH RECURSIVE matches AS (
  SELECT `id`, `effects` AS document,
    JSON_SEARCH(`effects`, 'all', '%', NULL, '$**.type') AS paths
  FROM `SkillTree`
), normalized (`id`, document, paths, tagIndex) AS (
  SELECT `id`, document,
    CASE WHEN JSON_TYPE(paths) = 'STRING' THEN JSON_ARRAY(JSON_UNQUOTE(paths)) ELSE paths END, 0
  FROM matches WHERE paths IS NOT NULL
  UNION ALL
  SELECT normalized.`id`,
    JSON_REMOVE(
      CASE
        WHEN JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.type')) IN ('increasestat', 'decreasestat')
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.statTypes')), 0) = 0
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.generalTypes')), 0) > 0
        THEN JSON_SET(normalized.document, CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.direction'), 'none')
        ELSE normalized.document
      END,
      CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.statTypes')
    ), normalized.paths, normalized.tagIndex + 1
  FROM normalized
  WHERE normalized.tagIndex < JSON_LENGTH(normalized.paths)
)
UPDATE `SkillTree` AS target
JOIN normalized ON target.`id` = normalized.`id`
  AND normalized.tagIndex = JSON_LENGTH(normalized.paths)
SET target.`effects` = normalized.document;

WITH RECURSIVE matches AS (
  SELECT `id`, `effects` AS document,
    JSON_SEARCH(`effects`, 'all', '%', NULL, '$**.type') AS paths
  FROM `SageMode`
), normalized (`id`, document, paths, tagIndex) AS (
  SELECT `id`, document,
    CASE WHEN JSON_TYPE(paths) = 'STRING' THEN JSON_ARRAY(JSON_UNQUOTE(paths)) ELSE paths END, 0
  FROM matches WHERE paths IS NOT NULL
  UNION ALL
  SELECT normalized.`id`,
    JSON_REMOVE(
      CASE
        WHEN JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.type')) IN ('increasestat', 'decreasestat')
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.statTypes')), 0) = 0
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.generalTypes')), 0) > 0
        THEN JSON_SET(normalized.document, CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.direction'), 'none')
        ELSE normalized.document
      END,
      CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.statTypes')
    ), normalized.paths, normalized.tagIndex + 1
  FROM normalized
  WHERE normalized.tagIndex < JSON_LENGTH(normalized.paths)
)
UPDATE `SageMode` AS target
JOIN normalized ON target.`id` = normalized.`id`
  AND normalized.tagIndex = JSON_LENGTH(normalized.paths)
SET target.`effects` = normalized.document;

WITH RECURSIVE matches AS (
  SELECT `id`, `afterEffects` AS document,
    JSON_SEARCH(`afterEffects`, 'all', '%', NULL, '$**.type') AS paths
  FROM `SageMode`
), normalized (`id`, document, paths, tagIndex) AS (
  SELECT `id`, document,
    CASE WHEN JSON_TYPE(paths) = 'STRING' THEN JSON_ARRAY(JSON_UNQUOTE(paths)) ELSE paths END, 0
  FROM matches WHERE paths IS NOT NULL
  UNION ALL
  SELECT normalized.`id`,
    JSON_REMOVE(
      CASE
        WHEN JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.type')) IN ('increasestat', 'decreasestat')
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.statTypes')), 0) = 0
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.generalTypes')), 0) > 0
        THEN JSON_SET(normalized.document, CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.direction'), 'none')
        ELSE normalized.document
      END,
      CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.statTypes')
    ), normalized.paths, normalized.tagIndex + 1
  FROM normalized
  WHERE normalized.tagIndex < JSON_LENGTH(normalized.paths)
)
UPDATE `SageMode` AS target
JOIN normalized ON target.`id` = normalized.`id`
  AND normalized.tagIndex = JSON_LENGTH(normalized.paths)
SET target.`afterEffects` = normalized.document;

WITH RECURSIVE matches AS (
  SELECT `id`, `level2Effects` AS document,
    JSON_SEARCH(`level2Effects`, 'all', '%', NULL, '$**.type') AS paths
  FROM `SageMode`
), normalized (`id`, document, paths, tagIndex) AS (
  SELECT `id`, document,
    CASE WHEN JSON_TYPE(paths) = 'STRING' THEN JSON_ARRAY(JSON_UNQUOTE(paths)) ELSE paths END, 0
  FROM matches WHERE paths IS NOT NULL
  UNION ALL
  SELECT normalized.`id`,
    JSON_REMOVE(
      CASE
        WHEN JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.type')) IN ('increasestat', 'decreasestat')
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.statTypes')), 0) = 0
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.generalTypes')), 0) > 0
        THEN JSON_SET(normalized.document, CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.direction'), 'none')
        ELSE normalized.document
      END,
      CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.statTypes')
    ), normalized.paths, normalized.tagIndex + 1
  FROM normalized
  WHERE normalized.tagIndex < JSON_LENGTH(normalized.paths)
)
UPDATE `SageMode` AS target
JOIN normalized ON target.`id` = normalized.`id`
  AND normalized.tagIndex = JSON_LENGTH(normalized.paths)
SET target.`level2Effects` = normalized.document;

WITH RECURSIVE matches AS (
  SELECT `id`, `effects` AS document,
    JSON_SEARCH(`effects`, 'all', '%', NULL, '$**.type') AS paths
  FROM `Item`
), normalized (`id`, document, paths, tagIndex) AS (
  SELECT `id`, document,
    CASE WHEN JSON_TYPE(paths) = 'STRING' THEN JSON_ARRAY(JSON_UNQUOTE(paths)) ELSE paths END, 0
  FROM matches WHERE paths IS NOT NULL
  UNION ALL
  SELECT normalized.`id`,
    JSON_REMOVE(
      CASE
        WHEN JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.type')) IN ('increasestat', 'decreasestat')
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.statTypes')), 0) = 0
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.generalTypes')), 0) > 0
        THEN JSON_SET(normalized.document, CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.direction'), 'none')
        ELSE normalized.document
      END,
      CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.statTypes')
    ), normalized.paths, normalized.tagIndex + 1
  FROM normalized
  WHERE normalized.tagIndex < JSON_LENGTH(normalized.paths)
)
UPDATE `Item` AS target
JOIN normalized ON target.`id` = normalized.`id`
  AND normalized.tagIndex = JSON_LENGTH(normalized.paths)
SET target.`effects` = normalized.document;

WITH RECURSIVE matches AS (
  SELECT `id`, `effects` AS document,
    JSON_SEARCH(`effects`, 'all', '%', NULL, '$**.type') AS paths
  FROM `Jutsu`
), normalized (`id`, document, paths, tagIndex) AS (
  SELECT `id`, document,
    CASE WHEN JSON_TYPE(paths) = 'STRING' THEN JSON_ARRAY(JSON_UNQUOTE(paths)) ELSE paths END, 0
  FROM matches WHERE paths IS NOT NULL
  UNION ALL
  SELECT normalized.`id`,
    JSON_REMOVE(
      CASE
        WHEN JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.type')) IN ('increasestat', 'decreasestat')
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.statTypes')), 0) = 0
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.generalTypes')), 0) > 0
        THEN JSON_SET(normalized.document, CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.direction'), 'none')
        ELSE normalized.document
      END,
      CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.statTypes')
    ), normalized.paths, normalized.tagIndex + 1
  FROM normalized
  WHERE normalized.tagIndex < JSON_LENGTH(normalized.paths)
)
UPDATE `Jutsu` AS target
JOIN normalized ON target.`id` = normalized.`id`
  AND normalized.tagIndex = JSON_LENGTH(normalized.paths)
SET target.`effects` = normalized.document;

WITH RECURSIVE matches AS (
  SELECT `userId`, `effects` AS document,
    JSON_SEARCH(`effects`, 'all', '%', NULL, '$**.type') AS paths
  FROM `UserData`
), normalized (`userId`, document, paths, tagIndex) AS (
  SELECT `userId`, document,
    CASE WHEN JSON_TYPE(paths) = 'STRING' THEN JSON_ARRAY(JSON_UNQUOTE(paths)) ELSE paths END, 0
  FROM matches WHERE paths IS NOT NULL
  UNION ALL
  SELECT normalized.`userId`,
    JSON_REMOVE(
      CASE
        WHEN JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.type')) IN ('increasestat', 'decreasestat')
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.statTypes')), 0) = 0
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.generalTypes')), 0) > 0
        THEN JSON_SET(normalized.document, CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.direction'), 'none')
        ELSE normalized.document
      END,
      CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.statTypes')
    ), normalized.paths, normalized.tagIndex + 1
  FROM normalized
  WHERE normalized.tagIndex < JSON_LENGTH(normalized.paths)
)
UPDATE `UserData` AS target
JOIN normalized ON target.`userId` = normalized.`userId`
  AND normalized.tagIndex = JSON_LENGTH(normalized.paths)
SET target.`effects` = normalized.document;

WITH RECURSIVE matches AS (
  SELECT `id`, `effects` AS document,
    JSON_SEARCH(`effects`, 'all', '%', NULL, '$**.type') AS paths
  FROM `RaidDamageThreshold`
), normalized (`id`, document, paths, tagIndex) AS (
  SELECT `id`, document,
    CASE WHEN JSON_TYPE(paths) = 'STRING' THEN JSON_ARRAY(JSON_UNQUOTE(paths)) ELSE paths END, 0
  FROM matches WHERE paths IS NOT NULL
  UNION ALL
  SELECT normalized.`id`,
    JSON_REMOVE(
      CASE
        WHEN JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.type')) IN ('increasestat', 'decreasestat')
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.statTypes')), 0) = 0
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.generalTypes')), 0) > 0
        THEN JSON_SET(normalized.document, CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.direction'), 'none')
        ELSE normalized.document
      END,
      CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.statTypes')
    ), normalized.paths, normalized.tagIndex + 1
  FROM normalized
  WHERE normalized.tagIndex < JSON_LENGTH(normalized.paths)
)
UPDATE `RaidDamageThreshold` AS target
JOIN normalized ON target.`id` = normalized.`id`
  AND normalized.tagIndex = JSON_LENGTH(normalized.paths)
SET target.`effects` = normalized.document;

WITH RECURSIVE matches AS (
  SELECT `id`, `effects` AS document,
    JSON_SEARCH(`effects`, 'all', '%', NULL, '$**.type') AS paths
  FROM `UserRaidBuff`
), normalized (`id`, document, paths, tagIndex) AS (
  SELECT `id`, document,
    CASE WHEN JSON_TYPE(paths) = 'STRING' THEN JSON_ARRAY(JSON_UNQUOTE(paths)) ELSE paths END, 0
  FROM matches WHERE paths IS NOT NULL
  UNION ALL
  SELECT normalized.`id`,
    JSON_REMOVE(
      CASE
        WHEN JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.type')) IN ('increasestat', 'decreasestat')
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.statTypes')), 0) = 0
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.generalTypes')), 0) > 0
        THEN JSON_SET(normalized.document, CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.direction'), 'none')
        ELSE normalized.document
      END,
      CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.statTypes')
    ), normalized.paths, normalized.tagIndex + 1
  FROM normalized
  WHERE normalized.tagIndex < JSON_LENGTH(normalized.paths)
)
UPDATE `UserRaidBuff` AS target
JOIN normalized ON target.`id` = normalized.`id`
  AND normalized.tagIndex = JSON_LENGTH(normalized.paths)
SET target.`effects` = normalized.document;

WITH RECURSIVE matches AS (
  SELECT `id`, `effects` AS document,
    JSON_SEARCH(`effects`, 'all', '%', NULL, '$**.type') AS paths
  FROM `PetSpecies`
), normalized (`id`, document, paths, tagIndex) AS (
  SELECT `id`, document,
    CASE WHEN JSON_TYPE(paths) = 'STRING' THEN JSON_ARRAY(JSON_UNQUOTE(paths)) ELSE paths END, 0
  FROM matches WHERE paths IS NOT NULL
  UNION ALL
  SELECT normalized.`id`,
    JSON_REMOVE(
      CASE
        WHEN JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.type')) IN ('increasestat', 'decreasestat')
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.statTypes')), 0) = 0
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.generalTypes')), 0) > 0
        THEN JSON_SET(normalized.document, CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.direction'), 'none')
        ELSE normalized.document
      END,
      CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.statTypes')
    ), normalized.paths, normalized.tagIndex + 1
  FROM normalized
  WHERE normalized.tagIndex < JSON_LENGTH(normalized.paths)
)
UPDATE `PetSpecies` AS target
JOIN normalized ON target.`id` = normalized.`id`
  AND normalized.tagIndex = JSON_LENGTH(normalized.paths)
SET target.`effects` = normalized.document;

WITH RECURSIVE matches AS (
  SELECT `id`, `usersEffects` AS document,
    JSON_SEARCH(`usersEffects`, 'all', '%', NULL, '$**.type') AS paths
  FROM `Battle`
), normalized (`id`, document, paths, tagIndex) AS (
  SELECT `id`, document,
    CASE WHEN JSON_TYPE(paths) = 'STRING' THEN JSON_ARRAY(JSON_UNQUOTE(paths)) ELSE paths END, 0
  FROM matches WHERE paths IS NOT NULL
  UNION ALL
  SELECT normalized.`id`,
    JSON_REMOVE(
      CASE
        WHEN JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.type')) IN ('increasestat', 'decreasestat')
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.statTypes')), 0) = 0
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.generalTypes')), 0) > 0
        THEN JSON_SET(normalized.document, CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.direction'), 'none')
        ELSE normalized.document
      END,
      CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.statTypes')
    ), normalized.paths, normalized.tagIndex + 1
  FROM normalized
  WHERE normalized.tagIndex < JSON_LENGTH(normalized.paths)
)
UPDATE `Battle` AS target
JOIN normalized ON target.`id` = normalized.`id`
  AND normalized.tagIndex = JSON_LENGTH(normalized.paths)
SET target.`usersEffects` = normalized.document;

WITH RECURSIVE matches AS (
  SELECT `id`, `groundEffects` AS document,
    JSON_SEARCH(`groundEffects`, 'all', '%', NULL, '$**.type') AS paths
  FROM `Battle`
), normalized (`id`, document, paths, tagIndex) AS (
  SELECT `id`, document,
    CASE WHEN JSON_TYPE(paths) = 'STRING' THEN JSON_ARRAY(JSON_UNQUOTE(paths)) ELSE paths END, 0
  FROM matches WHERE paths IS NOT NULL
  UNION ALL
  SELECT normalized.`id`,
    JSON_REMOVE(
      CASE
        WHEN JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.type')) IN ('increasestat', 'decreasestat')
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.statTypes')), 0) = 0
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.generalTypes')), 0) > 0
        THEN JSON_SET(normalized.document, CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.direction'), 'none')
        ELSE normalized.document
      END,
      CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.statTypes')
    ), normalized.paths, normalized.tagIndex + 1
  FROM normalized
  WHERE normalized.tagIndex < JSON_LENGTH(normalized.paths)
)
UPDATE `Battle` AS target
JOIN normalized ON target.`id` = normalized.`id`
  AND normalized.tagIndex = JSON_LENGTH(normalized.paths)
SET target.`groundEffects` = normalized.document;

WITH RECURSIVE matches AS (
  SELECT `id`, `extraState` AS document,
    JSON_SEARCH(`extraState`, 'all', '%', NULL, '$**.type') AS paths
  FROM `Battle`
), normalized (`id`, document, paths, tagIndex) AS (
  SELECT `id`, document,
    CASE WHEN JSON_TYPE(paths) = 'STRING' THEN JSON_ARRAY(JSON_UNQUOTE(paths)) ELSE paths END, 0
  FROM matches WHERE paths IS NOT NULL
  UNION ALL
  SELECT normalized.`id`,
    JSON_REMOVE(
      CASE
        WHEN JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.type')) IN ('increasestat', 'decreasestat')
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.statTypes')), 0) = 0
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.generalTypes')), 0) > 0
        THEN JSON_SET(normalized.document, CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.direction'), 'none')
        ELSE normalized.document
      END,
      CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.statTypes')
    ), normalized.paths, normalized.tagIndex + 1
  FROM normalized
  WHERE normalized.tagIndex < JSON_LENGTH(normalized.paths)
)
UPDATE `Battle` AS target
JOIN normalized ON target.`id` = normalized.`id`
  AND normalized.tagIndex = JSON_LENGTH(normalized.paths)
SET target.`extraState` = normalized.document;

WITH RECURSIVE matches AS (
  SELECT `id`, `usersState` AS document,
    JSON_SEARCH(`usersState`, 'all', '%', NULL, '$**.type') AS paths
  FROM `Battle`
), normalized (`id`, document, paths, tagIndex) AS (
  SELECT `id`, document,
    CASE WHEN JSON_TYPE(paths) = 'STRING' THEN JSON_ARRAY(JSON_UNQUOTE(paths)) ELSE paths END, 0
  FROM matches WHERE paths IS NOT NULL
  UNION ALL
  SELECT normalized.`id`,
    JSON_REMOVE(
      CASE
        WHEN JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.type')) IN ('increasestat', 'decreasestat')
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.statTypes')), 0) = 0
          AND COALESCE(JSON_LENGTH(JSON_EXTRACT(JSON_EXTRACT(normalized.document, REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', '')), '$.generalTypes')), 0) > 0
        THEN JSON_SET(normalized.document, CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.direction'), 'none')
        ELSE normalized.document
      END,
      CONCAT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(normalized.paths, CONCAT('$[', normalized.tagIndex, ']'))), '[.]"?type"?$', ''), '.statTypes')
    ), normalized.paths, normalized.tagIndex + 1
  FROM normalized
  WHERE normalized.tagIndex < JSON_LENGTH(normalized.paths)
)
UPDATE `Battle` AS target
JOIN normalized ON target.`id` = normalized.`id`
  AND normalized.tagIndex = JSON_LENGTH(normalized.paths)
SET target.`usersState` = normalized.document;
