CREATE INDEX `MpvpBattleQueue_territoryWar_idx` ON `MpvpBattleQueue` (`territoryWarId`);
CREATE INDEX `TerritoryWarScore_competitor_rewarded_idx` ON `TerritoryWarScore` (`competitorId`,`rewarded`);