ALTER TABLE `MpvpBattleQueue` ADD `raidMaxPlayers` tinyint DEFAULT 3 NOT NULL,
  ADD `raidClaimedAt` datetime(3);
ALTER TABLE `Quest` ADD `teamMaxPlayers` tinyint DEFAULT 3 NOT NULL;
ALTER TABLE `Quest` ADD `raidMaxPlayers` tinyint DEFAULT 3 NOT NULL;
ALTER TABLE `QuestParty` ADD `maxPlayers` tinyint DEFAULT 3 NOT NULL;
UPDATE `Dungeon`
SET `content` = JSON_SET(`content`, '$.maxPlayers', 3)
WHERE JSON_CONTAINS_PATH(`content`, 'one', '$.maxPlayers') = 0;

UPDATE `DungeonRun`
SET `content` = JSON_SET(`content`, '$.maxPlayers', 3)
WHERE JSON_CONTAINS_PATH(`content`, 'one', '$.maxPlayers') = 0;
