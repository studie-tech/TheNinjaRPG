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
DROP INDEX `TowerDefenseRun_startedAt_idx` ON `TowerDefenseRun`;
DROP INDEX `UserTowerDefenseUpgrade_upgradeId_idx` ON `UserTowerDefenseUpgrade`;
ALTER TABLE `TowerDefenseRun` ADD `startWave` int DEFAULT 1 NOT NULL;
ALTER TABLE `UserData` ADD `towerDefenseBestWave` int DEFAULT 0 NOT NULL;
CREATE INDEX `TowerDefenseRun_userId_startedAt_id_idx` ON `TowerDefenseRun` (`userId`,`startedAt`,`id`);
CREATE INDEX `TowerDefenseRun_wave_score_idx` ON `TowerDefenseRun` (`wave`,`score`);
ALTER TABLE `TowerDefenseClaimReceipt` DROP COLUMN `spacetimeSessionId`;
ALTER TABLE `TowerDefenseRun` DROP COLUMN `gridSize`;
ALTER TABLE `TowerDefenseRun` DROP COLUMN `status`;
ALTER TABLE `TowerDefenseRun` DROP COLUMN `state`;
-- The tower defense shuriken throw and hit sounds.
INSERT IGNORE INTO `GameAsset` (`id`, `name`, `type`, `image`, `url`, `hidden`, `folder`, `licenseDetails`) VALUES ('td-shuriken-throw', 'shuriken_throw_01', 'SFX', 'https://uploadthing.b-cdn.net/f/630cf6e7-c152-4dea-a3ff-821de76d7f5a_default.webp', 'https://uploadthing.b-cdn.net/f/sfx-td-shuriken-throw-5ab8d833d45db82e.mp3', 0, 'towerDefense', 'TNR');
INSERT IGNORE INTO `GameAsset` (`id`, `name`, `type`, `image`, `url`, `hidden`, `folder`, `licenseDetails`) VALUES ('td-shuriken-hit', 'shuriken_hit_01', 'SFX', 'https://uploadthing.b-cdn.net/f/630cf6e7-c152-4dea-a3ff-821de76d7f5a_default.webp', 'https://uploadthing.b-cdn.net/f/sfx-td-shuriken-hit-e67f0fbd3aeb8df2.mp3', 0, 'towerDefense', 'TNR');