-- Faction settlements use the same Auction House configuration as newly purchased hideouts.
INSERT INTO `VillageStructure` (
  `id`, `villageId`, `name`, `route`, `image`, `longitude`, `latitude`,
  `hasPage`, `showInVillagePage`, `allyAccess`, `level`, `maxLevel`, `curSp`, `maxSp`
)
SELECT
  CONCAT('faction-auction-', SHA2(`settlement`.`id`, 256)),
  `settlement`.`id`, `template`.`name`, `template`.`route`, `template`.`image`,
  `template`.`longitude`, `template`.`latitude`, `template`.`hasPage`,
  `template`.`showInVillagePage`, 1, 1, `template`.`maxLevel`,
  `template`.`curSp`, `template`.`maxSp`
FROM `Village` AS `settlement`
CROSS JOIN (
  SELECT * FROM `VillageStructure`
  WHERE `villageId` = 'ryBk0qD4EgvPPyav2K4OC' AND `route` = '/auctionhouse'
  ORDER BY `id`
  LIMIT 1
) AS `template`
WHERE `settlement`.`type` IN ('HIDEOUT', 'STRONGHOLD')
  AND NOT EXISTS (
    SELECT 1 FROM `VillageStructure` AS `existing`
    WHERE `existing`.`villageId` = `settlement`.`id`
      AND `existing`.`route` = '/auctionhouse'
  );
