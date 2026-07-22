-- Standard water is traversable at the same cost as ground. Explicitly
-- authored blocked tiles remain blocked through their per-tile map metadata.
UPDATE `MapTerrain`
SET `defaultWalkCost` = 1, `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `key` = 'ocean' AND `defaultWalkCost` <> 1;
