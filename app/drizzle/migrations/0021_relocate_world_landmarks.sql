-- Relocate every settlement whose old home no longer matches the committed
-- cylindrical globe. Targets were selected from the final deterministic
-- terrain (hierarchical-climate-v6-polar-landscape, +/-65 degrees). Main
-- village settings follow the protected Road to Genin tutorial quest:
-- Akikaze=Hidden Wind, Shirohana=desert, Tsukimori=Moon Forest, Hyorin=ice,
-- Akasumi=storm/coast.
-- Horizon's lush setting is kept consistent with its starting-village art and
-- placed near Wake Island to keep the new-player route geographically compact.
--
--   Settlement       | accepted legacy homes | new  | setting
--   -----------------|-----------------------|------|----------------------------
--   Freedom State    | 51                    |  555 | inland ground
--   Akikaze          | 271                   |  724 | elevated green highland
--   Horizon          | 296, 913              |  301 | lush ground near Wake Island
--   Tsukimori        | 305                   | 1490 | cool, lush Moon Forest
--   Syndicate        | 484                   | 1062 | dry rocky desert
--   SafariFaction    | 485                   | 1000 | inland ground
--   Hyorin           | 203, 688              |  177 | ice
--   Shirohana        | 83, 1631              | 1538 | desert
--   Akasumi          | 254, 1784             | 1335 | wet coast, marker on land
--
-- Wake Island remains at 222, where the generator now creates a small island
-- inside the sector with four ocean neighbours. Iron Shield remains at 352,
-- whose ground biome already matches it.
--
-- Each move accepts both the original seed position and any position assigned
-- by the previous cube-world migration, and is guarded by an unclaimed target.
-- It moves the village's home ownership row and only members of that village
-- who are standing in the old home. Visitors and unrelated territorial claims
-- stay where they are. (13,7) is the generated village spawn anchor.
--
-- After applying this migration, republish ALL sector maps because the shared
-- land/coast/climate field changed globally:
--   bun run scripts/publish-sector-maps.ts

UPDATE `Village` SET `sector` = 555
WHERE `name` = 'Freedom State' AND `sector` = 51
  AND NOT EXISTS (SELECT 1 FROM `Sector` WHERE `sector` = 555);--> statement-breakpoint
UPDATE `Sector` SET `sector` = 555
WHERE `sector` = 51 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Freedom State' AND `sector` = 555);--> statement-breakpoint
UPDATE `UserData` SET `sector` = 555, `longitude` = 13, `latitude` = 7
WHERE `sector` = 51 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Freedom State' AND `sector` = 555);--> statement-breakpoint

UPDATE `Village` SET `sector` = 724
WHERE `name` = 'Akikaze' AND `sector` = 271
  AND NOT EXISTS (SELECT 1 FROM `Sector` WHERE `sector` = 724);--> statement-breakpoint
UPDATE `Sector` SET `sector` = 724
WHERE `sector` = 271 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Akikaze' AND `sector` = 724);--> statement-breakpoint
UPDATE `UserData` SET `sector` = 724, `longitude` = 13, `latitude` = 7
WHERE `sector` = 271 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Akikaze' AND `sector` = 724);--> statement-breakpoint

UPDATE `Village` SET `sector` = 301
WHERE `name` = 'Horizon' AND `sector` IN (296, 913)
  AND NOT EXISTS (SELECT 1 FROM `Sector` WHERE `sector` = 301);--> statement-breakpoint
UPDATE `Sector` SET `sector` = 301
WHERE `sector` IN (296, 913) AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Horizon' AND `sector` = 301);--> statement-breakpoint
UPDATE `UserData` SET `sector` = 301, `longitude` = 13, `latitude` = 7
WHERE `sector` IN (296, 913) AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Horizon' AND `sector` = 301);--> statement-breakpoint

UPDATE `Village` SET `sector` = 1490
WHERE `name` = 'Tsukimori' AND `sector` = 305
  AND NOT EXISTS (SELECT 1 FROM `Sector` WHERE `sector` = 1490);--> statement-breakpoint
UPDATE `Sector` SET `sector` = 1490
WHERE `sector` = 305 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Tsukimori' AND `sector` = 1490);--> statement-breakpoint
UPDATE `UserData` SET `sector` = 1490, `longitude` = 13, `latitude` = 7
WHERE `sector` = 305 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Tsukimori' AND `sector` = 1490);--> statement-breakpoint

UPDATE `Village` SET `sector` = 1062
WHERE `name` = 'Syndicate' AND `sector` = 484
  AND NOT EXISTS (SELECT 1 FROM `Sector` WHERE `sector` = 1062);--> statement-breakpoint
UPDATE `Sector` SET `sector` = 1062
WHERE `sector` = 484 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Syndicate' AND `sector` = 1062);--> statement-breakpoint
UPDATE `UserData` SET `sector` = 1062, `longitude` = 13, `latitude` = 7
WHERE `sector` = 484 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Syndicate' AND `sector` = 1062);--> statement-breakpoint

UPDATE `Village` SET `sector` = 1000
WHERE `name` = 'SafariFaction' AND `sector` = 485
  AND NOT EXISTS (SELECT 1 FROM `Sector` WHERE `sector` = 1000);--> statement-breakpoint
UPDATE `Sector` SET `sector` = 1000
WHERE `sector` = 485 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'SafariFaction' AND `sector` = 1000);--> statement-breakpoint
UPDATE `UserData` SET `sector` = 1000, `longitude` = 13, `latitude` = 7
WHERE `sector` = 485 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'SafariFaction' AND `sector` = 1000);--> statement-breakpoint

UPDATE `Village` SET `sector` = 177
WHERE `name` = 'Hyorin' AND `sector` IN (203, 688)
  AND NOT EXISTS (SELECT 1 FROM `Sector` WHERE `sector` = 177);--> statement-breakpoint
UPDATE `Sector` SET `sector` = 177
WHERE `sector` IN (203, 688) AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Hyorin' AND `sector` = 177);--> statement-breakpoint
UPDATE `UserData` SET `sector` = 177, `longitude` = 13, `latitude` = 7
WHERE `sector` IN (203, 688) AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Hyorin' AND `sector` = 177);--> statement-breakpoint

UPDATE `Village` SET `sector` = 1538
WHERE `name` = 'Shirohana' AND `sector` IN (83, 1631)
  AND NOT EXISTS (SELECT 1 FROM `Sector` WHERE `sector` = 1538);--> statement-breakpoint
UPDATE `Sector` SET `sector` = 1538
WHERE `sector` IN (83, 1631) AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Shirohana' AND `sector` = 1538);--> statement-breakpoint
UPDATE `UserData` SET `sector` = 1538, `longitude` = 13, `latitude` = 7
WHERE `sector` IN (83, 1631) AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Shirohana' AND `sector` = 1538);--> statement-breakpoint

UPDATE `Village` SET `sector` = 1335
WHERE `name` = 'Akasumi' AND `sector` IN (254, 1784)
  AND NOT EXISTS (SELECT 1 FROM `Sector` WHERE `sector` = 1335);--> statement-breakpoint
UPDATE `Sector` SET `sector` = 1335
WHERE `sector` IN (254, 1784) AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Akasumi' AND `sector` = 1335);--> statement-breakpoint
UPDATE `UserData` SET `sector` = 1335, `longitude` = 13, `latitude` = 7
WHERE `sector` IN (254, 1784) AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Akasumi' AND `sector` = 1335);--> statement-breakpoint

-- Wake Island's legacy facilities occupied x=1..5. Those coordinates are now
-- surrounding ocean, so place every facility on a distinct walkable tile of
-- the generated central island.
UPDATE `VillageStructure` SET `longitude` = 13, `latitude` = 8
WHERE `name` = 'Administration Building' AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Wake Island' AND `sector` = 222);--> statement-breakpoint
UPDATE `VillageStructure` SET `longitude` = 10, `latitude` = 10
WHERE `name` = 'Auction House' AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Wake Island' AND `sector` = 222);--> statement-breakpoint
UPDATE `VillageStructure` SET `longitude` = 16, `latitude` = 10
WHERE `name` = 'Mini Games' AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Wake Island' AND `sector` = 222);--> statement-breakpoint
UPDATE `VillageStructure` SET `longitude` = 9, `latitude` = 13
WHERE `name` = 'Colosseum' AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Wake Island' AND `sector` = 222);--> statement-breakpoint
UPDATE `VillageStructure` SET `longitude` = 17, `latitude` = 13
WHERE `name` = 'History Building' AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Wake Island' AND `sector` = 222);--> statement-breakpoint
UPDATE `VillageStructure` SET `longitude` = 10, `latitude` = 16
WHERE `name` = 'Global ANBU HQ' AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Wake Island' AND `sector` = 222);--> statement-breakpoint
UPDATE `VillageStructure` SET `longitude` = 16, `latitude` = 16
WHERE `name` = 'Souvenir Shop' AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Wake Island' AND `sector` = 222);--> statement-breakpoint
UPDATE `VillageStructure` SET `longitude` = 13, `latitude` = 14
WHERE `name` = 'Science Building' AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Wake Island' AND `sector` = 222);
