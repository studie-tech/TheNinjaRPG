-- The Dojo replaces staff-defined upgrades: refund every point spent on them, then start fresh.
UPDATE `UserData` u JOIN (SELECT uu.`userId`, SUM(CASE WHEN d.`costMultiplier` = 1 THEN d.`baseCost` * uu.`level` ELSE CEIL(d.`baseCost` * (POW(d.`costMultiplier`, uu.`level`) - 1) / (d.`costMultiplier` - 1)) END) AS refund FROM `UserTowerDefenseUpgrade` uu JOIN `TowerDefenseUpgrade` d ON d.`id` = uu.`upgradeId` GROUP BY uu.`userId`) r ON r.`userId` = u.`userId` SET u.`towerDefensePoints` = u.`towerDefensePoints` + LEAST(r.refund, 1000000000);
DELETE FROM `UserTowerDefenseUpgrade`;
-- Waves from the previous game are not comparable with the new one.
DELETE FROM `TowerDefenseRun`;
DROP TABLE `TowerDefenseCharacter`;
DROP TABLE `TowerDefenseUpgrade`;
DROP INDEX `TowerDefenseRun_status_idx` ON `TowerDefenseRun`;
DROP INDEX `TowerDefenseRun_userId_status_idx` ON `TowerDefenseRun`;
DROP INDEX `TowerDefenseRun_score_idx` ON `TowerDefenseRun`;
ALTER TABLE `TowerDefenseRun` ADD `startWave` int DEFAULT 1 NOT NULL;
ALTER TABLE `UserData` ADD `towerDefenseBestWave` int DEFAULT 0 NOT NULL;
CREATE INDEX `TowerDefenseRun_userId_idx` ON `TowerDefenseRun` (`userId`);
CREATE INDEX `TowerDefenseRun_wave_score_idx` ON `TowerDefenseRun` (`wave`,`score`);
ALTER TABLE `TowerDefenseClaimReceipt` DROP COLUMN `spacetimeSessionId`;
ALTER TABLE `TowerDefenseRun` DROP COLUMN `gridSize`;
ALTER TABLE `TowerDefenseRun` DROP COLUMN `status`;
ALTER TABLE `TowerDefenseRun` DROP COLUMN `state`;