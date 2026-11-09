-- Wildlife roaming the world map: one ambient AI per species with walk and idle sheets, placed
-- as many copies across its habitat. Conflicts keep rows staff have since edited.

INSERT INTO `UserData` (`userId`, `username`, `gender`, `curHealth`, `maxHealth`, `curChakra`, `maxChakra`, `curStamina`, `maxStamina`, `regeneration`, `experience`, `rank`, `level`, `status`, `strength`, `intelligence`, `willpower`, `speed`, `offence`, `defence`, `ninjutsuMastery`, `genjutsuMastery`, `taijutsuMastery`, `bukijutsuMastery`, `masteryRanks`, `approvedTos`, `avatar`, `avatarLight`, `avatarFacing`, `role`, `isAi`, `poolsMultiplier`, `statsMultiplier`, `preferredGeneral1`, `preferredGeneral2`) VALUES
  ('wildlife-deer', 'Red Deer', 'Unknown', 300, 300, 300, 300, 300, 300, 60, 0, 'STUDENT', 8, 'AWAKE', 4000, 4000, 4000, 4000, 4000, 4000, 0, 0, 4000, 0, '{"ninjutsuMastery":"NONE","genjutsuMastery":"NONE","taijutsuMastery":"NONE","bukijutsuMastery":"NONE","bloodlineMastery":"NONE","sageMastery":"NONE"}', 1, 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJpmpakTbKBAOsGCHyl3Sk0mZFrgWPUdjMJ75D', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ4WXu7AlYIif5CL8BKvMsOh2ZnmS7yHt0jTD3', 'left', 'USER', 1, 1, 1, 'Speed', 'Strength'),
  ('wildlife-boar', 'Bristleback Boar', 'Unknown', 500, 500, 500, 500, 500, 500, 60, 0, 'GENIN', 14, 'AWAKE', 7000, 7000, 7000, 7000, 7000, 7000, 0, 0, 7000, 0, '{"ninjutsuMastery":"NONE","genjutsuMastery":"NONE","taijutsuMastery":"NONE","bukijutsuMastery":"NONE","bloodlineMastery":"NONE","sageMastery":"NONE"}', 1, 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJZO9XkcGaYQrBIUTu69nkMxWmS4ah0O7LVCp8', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ1zlgKAM6bo95WClq4K0wxZUmJcvThgdVenO3', 'left', 'USER', 1, 1, 1, 'Strength', 'Strength'),
  ('wildlife-rabbit', 'Meadow Rabbit', 'Unknown', 120, 120, 120, 120, 120, 120, 60, 0, 'STUDENT', 3, 'AWAKE', 1500, 1500, 1500, 1500, 1500, 1500, 0, 0, 1500, 0, '{"ninjutsuMastery":"NONE","genjutsuMastery":"NONE","taijutsuMastery":"NONE","bukijutsuMastery":"NONE","bloodlineMastery":"NONE","sageMastery":"NONE"}', 1, 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJaRTOkIYYfKMcJ2B5EmWt6VsNgqxpG8OSXAQk', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJrbBd5thuJPmdY8zI2ptZXAoEj1c6BMKvrQOx', 'left', 'USER', 1, 1, 1, 'Speed', 'Strength'),
  ('wildlife-fox', 'Red Fox', 'Unknown', 260, 260, 260, 260, 260, 260, 60, 0, 'STUDENT', 10, 'AWAKE', 5000, 5000, 5000, 5000, 5000, 5000, 0, 0, 5000, 0, '{"ninjutsuMastery":"NONE","genjutsuMastery":"NONE","taijutsuMastery":"NONE","bukijutsuMastery":"NONE","bloodlineMastery":"NONE","sageMastery":"NONE"}', 1, 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ7doh07TXKPBOUWGyFuM4DlL1v5HNTZhkte0z', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJeEAnmJyV3OvUJQExAi0bGoIZDF74LqSnHRdp', 'left', 'USER', 1, 1, 1, 'Speed', 'Strength'),
  ('wildlife-camel', 'Dune Camel', 'Unknown', 520, 520, 520, 520, 520, 520, 60, 0, 'GENIN', 12, 'AWAKE', 6000, 6000, 6000, 6000, 6000, 6000, 0, 0, 6000, 0, '{"ninjutsuMastery":"NONE","genjutsuMastery":"NONE","taijutsuMastery":"NONE","bukijutsuMastery":"NONE","bloodlineMastery":"NONE","sageMastery":"NONE"}', 1, 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJwR88llT2j854CWbaITZyegfXimvd7s16cO0h', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJnQltfp5mojJ0EqeDCvBrNmZaXVdY97gSpOWi', 'left', 'USER', 1, 1, 1, 'Strength', 'Strength'),
  ('wildlife-icebear', 'Ice Bear', 'Unknown', 1500, 1500, 1500, 1500, 1500, 1500, 60, 0, 'GENIN', 30, 'AWAKE', 15000, 15000, 15000, 15000, 15000, 15000, 0, 0, 15000, 0, '{"ninjutsuMastery":"NONE","genjutsuMastery":"NONE","taijutsuMastery":"NONE","bukijutsuMastery":"NONE","bloodlineMastery":"NONE","sageMastery":"NONE"}', 1, 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJzVSXEzemvaQu94EYJs8HpxVzofny6iPtbgCZ', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJdqXmGaP62PI3ciLaYzgVX8FopBADxSrGmvQl', 'left', 'USER', 1, 1, 1, 'Strength', 'Strength'),
  ('wildlife-reindeer', 'Tundra Reindeer', 'Unknown', 450, 450, 450, 450, 450, 450, 60, 0, 'GENIN', 12, 'AWAKE', 6000, 6000, 6000, 6000, 6000, 6000, 0, 0, 6000, 0, '{"ninjutsuMastery":"NONE","genjutsuMastery":"NONE","taijutsuMastery":"NONE","bukijutsuMastery":"NONE","bloodlineMastery":"NONE","sageMastery":"NONE"}', 1, 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJQliNhS6jhzBPya1rwfCIqOTU0cV5xgsMeo3u', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJck9gMtSnxBpQqGNDcTHbLmYz8uXAl3oa54ti', 'left', 'USER', 1, 1, 1, 'Speed', 'Strength')
ON DUPLICATE KEY UPDATE `userId` = `UserData`.`userId`;

INSERT INTO `SpriteAnimation` (`id`, `name`, `url`, `smallUrl`, `columns`, `rows`, `frameCount`, `fps`, `facing`, `createdByUserId`) VALUES
  ('wildlife-sheet-deer-idle', 'Red Deer — Idle', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJH8K62AQvYURJhgs76VZtf9wxpMa13Cq0iOnr', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJOWB6MbVHevxIThUauQkGJEBY3D2cPqy8f5sp', 8, 3, 24, 12.5, 'left', 'system:wildlife'),
  ('wildlife-sheet-deer-move', 'Red Deer — Move', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJmhp1BcHE4IMO5Goa7cgLxPJ0VC6lU8vbt1Ap', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJvBeeXxEmSnXwslYEpV1yOeNL8gMtqhjPdf36', 8, 2, 16, 12.5, 'left', 'system:wildlife'),
  ('wildlife-sheet-boar-idle', 'Bristleback Boar — Idle', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJunAb0wCyJLoOFkrcn4gxSwCfEQ9eMNXZlG8b', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJoYVBsNQZ9MPZpHJ7VliuEWDfATdxhv62SXnm', 8, 3, 24, 12.5, 'left', 'system:wildlife'),
  ('wildlife-sheet-boar-move', 'Bristleback Boar — Move', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJpoF3TYHbKBAOsGCHyl3Sk0mZFrgWPUdjMJ75', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJtPakwnUYJDfpFXWm3nrcPluEtIZqyLkaSV1j', 8, 2, 16, 12.5, 'left', 'system:wildlife'),
  ('wildlife-sheet-rabbit-idle', 'Meadow Rabbit — Idle', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJy2jM2XyukVH2MI5Lo4ehEfAXvZdcmtWqPg7r', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJcIIB4CSnxBpQqGNDcTHbLmYz8uXAl3oa54ti', 8, 3, 24, 12.5, 'left', 'system:wildlife'),
  ('wildlife-sheet-rabbit-move', 'Meadow Rabbit — Move', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJDKYUhEzEwoh0WXMnscL279N8ayVQUCbRzS3p', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJvI2J2jEmSnXwslYEpV1yOeNL8gMtqhjPdf36', 8, 2, 16, 12.5, 'left', 'system:wildlife'),
  ('wildlife-sheet-fox-idle', 'Red Fox — Idle', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJyJQgFAukVH2MI5Lo4ehEfAXvZdcmtWqPg7rp', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJPyc5HHpKeUGyX2kj6u45AOQiSa1zYH0mqZoc', 8, 3, 24, 12.5, 'left', 'system:wildlife'),
  ('wildlife-sheet-fox-move', 'Red Fox — Move', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJSk1zV6u3jWrEB7TyZlmpoAxMK5Qi16kNPVJu', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJA2bLR1oZUC4muiGcQNzjfEndY5y1w20B8hTW', 8, 2, 16, 12.5, 'left', 'system:wildlife'),
  ('wildlife-sheet-camel-idle', 'Dune Camel — Idle', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ3uCaet8pYHJX5rdkUTfOKtvu2eGIELmSWqBx', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJXnYklaqIOpAoLKbZ4nW9Rsil2V67yuFwQhqv', 8, 3, 24, 12.5, 'left', 'system:wildlife'),
  ('wildlife-sheet-camel-move', 'Dune Camel — Move', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJDpZWY2zEwoh0WXMnscL279N8ayVQUCbRzS3p', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ2ZQuVznMXlcRpYmJ5do0zKw4Qx6PVEtBa9b8', 8, 2, 16, 12.5, 'left', 'system:wildlife'),
  ('wildlife-sheet-icebear-idle', 'Ice Bear — Idle', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJZTbCO1aYQrBIUTu69nkMxWmS4ah0O7LVCp8b', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ4MkZ2elYIif5CL8BKvMsOh2ZnmS7yHt0jTD3', 8, 3, 24, 12.5, 'left', 'system:wildlife'),
  ('wildlife-sheet-icebear-move', 'Ice Bear — Move', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJzfO6rAemvaQu94EYJs8HpxVzofny6iPtbgCZ', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJtxfxceUYJDfpFXWm3nrcPluEtIZqyLkaSV1j', 8, 2, 16, 12.5, 'left', 'system:wildlife'),
  ('wildlife-sheet-reindeer-idle', 'Tundra Reindeer — Idle', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJy2nmJAFukVH2MI5Lo4ehEfAXvZdcmtWqPg7r', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJMLxYXGtsO4cexqW2RDgkE3zZbNXSFGitmnar', 8, 3, 24, 12.5, 'left', 'system:wildlife'),
  ('wildlife-sheet-reindeer-move', 'Tundra Reindeer — Move', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJeLQGS6yV3OvUJQExAi0bGoIZDF74LqSnHRdp', 'https://uploadthing.b-cdn.net/f/Hzww9EQvYURJmscIt3HE4IMO5Goa7cgLxPJ0VC6lU8vbt1Ap', 8, 2, 16, 12.5, 'left', 'system:wildlife')
ON DUPLICATE KEY UPDATE `id` = `SpriteAnimation`.`id`;

INSERT INTO `AiSpriteAnimation` (`userId`, `actionKey`, `animationId`) VALUES
  ('wildlife-deer', 'idle', 'wildlife-sheet-deer-idle'),
  ('wildlife-deer', 'move', 'wildlife-sheet-deer-move'),
  ('wildlife-boar', 'idle', 'wildlife-sheet-boar-idle'),
  ('wildlife-boar', 'move', 'wildlife-sheet-boar-move'),
  ('wildlife-rabbit', 'idle', 'wildlife-sheet-rabbit-idle'),
  ('wildlife-rabbit', 'move', 'wildlife-sheet-rabbit-move'),
  ('wildlife-fox', 'idle', 'wildlife-sheet-fox-idle'),
  ('wildlife-fox', 'move', 'wildlife-sheet-fox-move'),
  ('wildlife-camel', 'idle', 'wildlife-sheet-camel-idle'),
  ('wildlife-camel', 'move', 'wildlife-sheet-camel-move'),
  ('wildlife-icebear', 'idle', 'wildlife-sheet-icebear-idle'),
  ('wildlife-icebear', 'move', 'wildlife-sheet-icebear-move'),
  ('wildlife-reindeer', 'idle', 'wildlife-sheet-reindeer-idle'),
  ('wildlife-reindeer', 'move', 'wildlife-sheet-reindeer-move')
ON DUPLICATE KEY UPDATE `animationId` = `AiSpriteAnimation`.`animationId`;

INSERT INTO `OverworldAiPlacement` (`id`, `aiTemplateUserId`, `interactionType`, `isActive`, `sectorType`, `locationType`, `sectorList`, `sector`, `longitude`, `latitude`, `positionVersion`, `wanderRadius`, `spawnCount`, `groupMin`, `groupMax`, `habitats`, `wildOnly`, `mapScale`) VALUES
  ('wildlife-deer-placement', 'wildlife-deer', 'AMBIENT', 1, 'biome', 'random', '[]', 319, 13, 13, 0, 5, 2, 3, 5, '["grassland"]', 1, 90),
  ('wildlife-boar-placement', 'wildlife-boar', 'AMBIENT', 1, 'biome', 'random', '[]', 332, 13, 13, 0, 5, 2, 2, 3, '["grassland"]', 1, 75),
  ('wildlife-rabbit-placement', 'wildlife-rabbit', 'AMBIENT', 1, 'biome', 'random', '[]', 333, 13, 13, 0, 5, 2, 1, 2, '["grassland"]', 1, 50),
  ('wildlife-fox-placement', 'wildlife-fox', 'AMBIENT', 1, 'biome', 'random', '[]', 334, 13, 13, 0, 5, 1, 1, 1, '["grassland"]', 1, 70),
  ('wildlife-camel-placement', 'wildlife-camel', 'AMBIENT', 1, 'biome', 'random', '[]', 813, 13, 13, 0, 5, 3, 2, 4, '["desert"]', 1, 100),
  ('wildlife-icebear-placement', 'wildlife-icebear', 'AMBIENT', 1, 'biome', 'random', '[]', 193, 13, 13, 0, 5, 2, 1, 1, '["snow"]', 1, 100),
  ('wildlife-reindeer-placement', 'wildlife-reindeer', 'AMBIENT', 1, 'biome', 'random', '[]', 194, 13, 13, 0, 5, 2, 3, 5, '["snow"]', 1, 95)
ON DUPLICATE KEY UPDATE `id` = `OverworldAiPlacement`.`id`;
