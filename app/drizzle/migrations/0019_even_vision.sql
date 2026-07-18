CREATE TABLE `MapAsset` (
	`id` varchar(191) NOT NULL,
	`key` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL,
	`category` varchar(191) NOT NULL DEFAULT '',
	`imageUrl` varchar(512) NOT NULL,
	`windAffected` boolean NOT NULL DEFAULT false,
	`small` boolean NOT NULL DEFAULT false,
	`randomRotation` boolean NOT NULL DEFAULT false,
	`renderScale` double NOT NULL DEFAULT 1,
	`licenseDetails` text NOT NULL DEFAULT ('TNR'),
	`createdByUserId` varchar(191),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `MapAsset_id` PRIMARY KEY(`id`),
	CONSTRAINT `MapAsset_key_key` UNIQUE(`key`)
);

CREATE TABLE `MapTerrain` (
	`id` varchar(191) NOT NULL,
	`key` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL,
	`colors` json NOT NULL,
	`textureUrl` varchar(512),
	`swatchColor` varchar(16) NOT NULL,
	`battleBiome` enum('ocean','ground','dessert','ice','snow','arena','default') NOT NULL DEFAULT 'ground',
	`isWater` boolean NOT NULL DEFAULT false,
	`depression` float NOT NULL DEFAULT 0,
	`defaultWalkCost` int NOT NULL DEFAULT 1,
	`protected` boolean NOT NULL DEFAULT false,
	`licenseDetails` text NOT NULL DEFAULT ('TNR'),
	`createdByUserId` varchar(191),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `MapTerrain_id` PRIMARY KEY(`id`),
	CONSTRAINT `MapTerrain_key_key` UNIQUE(`key`)
);

CREATE TABLE `SectorMap` (
	`id` varchar(191) NOT NULL,
	`sector` smallint unsigned NOT NULL,
	`name` varchar(191) NOT NULL,
	`width` smallint unsigned NOT NULL,
	`height` smallint unsigned NOT NULL,
	`status` enum('DRAFT','PUBLISHED','ARCHIVED') NOT NULL,
	`version` int unsigned NOT NULL DEFAULT 1,
	`sourceHash` varchar(191),
	`rawTiledJson` json,
	`normalizedJson` json NOT NULL,
	`publishedAt` datetime(3),
	`publishedByUserId` varchar(191),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `SectorMap_id` PRIMARY KEY(`id`),
	CONSTRAINT `SectorMap_sector_version_key` UNIQUE(`sector`,`version`)
);

ALTER TABLE `UserData` MODIFY COLUMN `longitude` smallint unsigned NOT NULL DEFAULT 10;
ALTER TABLE `UserData` MODIFY COLUMN `latitude` smallint unsigned NOT NULL DEFAULT 7;
ALTER TABLE `VillageStructure` MODIFY COLUMN `longitude` smallint NOT NULL DEFAULT 10;
ALTER TABLE `VillageStructure` MODIFY COLUMN `latitude` smallint NOT NULL DEFAULT 10;
CREATE INDEX `MapAsset_category_idx` ON `MapAsset` (`category`);
CREATE INDEX `SectorMap_sector_status_idx` ON `SectorMap` (`sector`,`status`);--> statement-breakpoint
-- Village biome relocation: move each village to a sector whose globe biome
-- matches its theme (art/colors), on the 1944-sector cube-sphere world.
--
--   Village    | old sector (biome)  | new sector (biome)          | rationale
--   -----------|---------------------|-----------------------------|-----------------------------------------
--   Hyorin     | 203 (ground)        | 688 (ice, ice-locked)       | snow/ice mountain citadel art, white color
--   Shirohana  |  83 (ground)        | 1631 (dessert, inland)      | red-rock desert citadel art, golden color
--   Akasumi    | 254 (ground inland) | 1784 (ground, 3 sea nbrs)   | harbor-on-a-lagoon art -> coastal sector
--
-- Unchanged (theme already matches or fixed by code):
--   Akikaze 271 (ground, sky/forest art), Tsukimori 305 (ground, moon-forest),
--   Horizon 296 (dessert, sandstone spires), Freedom State 51, Iron Shield 352,
--   City of Mei 484, SafariFaction 485, Wake Island 222 (MAP_WAKE_ISLAND_SECTOR
--   code constant - never move via code).
--
-- Water-stranded settlements (prod audit 2026-07-18): legacy sector ids that
-- land in OCEAN on the new 1944-sector globe. Each moves to the nearest land
-- sector that is unreserved, unoccupied, and outside every faction's Sector
-- territory claims:
--
--   Settlement                    | type    | old (ocean) | new (biome)
--   ------------------------------|---------|-------------|----------------
--   Alliance of sinister shadows  | HIDEOUT | 399         | 400  (ground)
--   Amatsukami                    | HIDEOUT | 247         | 250  (ground)
--   Current (Members Only)        | HIDEOUT | 320         | 319  (ground)
--   Silence Valley                | HIDEOUT | 228         | 213  (ground)
--   The Legend of Vox Machina     | HIDEOUT | 145         | 1133 (ice)
--   Fallen Arcana                 | TOWN    | 155         | 156  (ground)
--
-- Villages are matched by their unique name (Village_name_key) so the same
-- file applies to every environment regardless of row ids. Each move updates:
-- the village home sector, its Sector ownership/shrine claim, and relocates
-- that village's own members standing in the old home sector to the new one at
-- the village spawn tile (13,7). Visitors from other factions are left where
-- they are (the old sector simply becomes wilderness). Guard clauses on the
-- old sector make re-runs no-ops.
--
-- AFTER applying, regenerate + republish the six affected sector maps so the
-- new homes get village maps (walls/roads/structure anchors) and the old ones
-- revert to wilderness:
--   bun run scripts/publish-sector-maps.ts --sectors 83,203,254,688,1631,1784
-- Any future globe regeneration must use the new village list:
--   --villages "51,296,305,352,484,485,688,1631,1784" (plus growth seeds)
-- Quest objectives pinned to sectors 83/203/254 (if any) need a content review.

UPDATE `Village` SET `sector` = 688 WHERE `name` = 'Hyorin' AND `sector` = 203;
UPDATE `Sector` SET `sector` = 688 WHERE `sector` = 203 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Hyorin');
UPDATE `UserData` SET `sector` = 688, `longitude` = 13, `latitude` = 7 WHERE `sector` = 203 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Hyorin');

UPDATE `Village` SET `sector` = 1631 WHERE `name` = 'Shirohana' AND `sector` = 83;
UPDATE `Sector` SET `sector` = 1631 WHERE `sector` = 83 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Shirohana');
UPDATE `UserData` SET `sector` = 1631, `longitude` = 13, `latitude` = 7 WHERE `sector` = 83 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Shirohana');

UPDATE `Village` SET `sector` = 1784 WHERE `name` = 'Akasumi' AND `sector` = 254;
UPDATE `Sector` SET `sector` = 1784 WHERE `sector` = 254 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Akasumi');
UPDATE `UserData` SET `sector` = 1784, `longitude` = 13, `latitude` = 7 WHERE `sector` = 254 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Akasumi');--> statement-breakpoint

-- Water-stranded hideouts/towns: same guarded pattern as the villages above
-- (matched by unique name + current sector so re-runs and drifted rows no-op;
-- moves the settlement, its own home-territory claim, and its members).
UPDATE `Village` SET `sector` = 400 WHERE `name` = 'Alliance of sinister shadows' AND `sector` = 399;--> statement-breakpoint
UPDATE `Sector` SET `sector` = 400 WHERE `sector` = 399 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Alliance of sinister shadows');--> statement-breakpoint
UPDATE `UserData` SET `sector` = 400, `longitude` = 13, `latitude` = 7 WHERE `sector` = 399 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Alliance of sinister shadows');--> statement-breakpoint

UPDATE `Village` SET `sector` = 250 WHERE `name` = 'Amatsukami' AND `sector` = 247;--> statement-breakpoint
UPDATE `Sector` SET `sector` = 250 WHERE `sector` = 247 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Amatsukami');--> statement-breakpoint
UPDATE `UserData` SET `sector` = 250, `longitude` = 13, `latitude` = 7 WHERE `sector` = 247 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Amatsukami');--> statement-breakpoint

UPDATE `Village` SET `sector` = 319 WHERE `name` = 'Current (Members Only)' AND `sector` = 320;--> statement-breakpoint
UPDATE `Sector` SET `sector` = 319 WHERE `sector` = 320 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Current (Members Only)');--> statement-breakpoint
UPDATE `UserData` SET `sector` = 319, `longitude` = 13, `latitude` = 7 WHERE `sector` = 320 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Current (Members Only)');--> statement-breakpoint

UPDATE `Village` SET `sector` = 213 WHERE `name` = 'Silence Valley' AND `sector` = 228;--> statement-breakpoint
UPDATE `Sector` SET `sector` = 213 WHERE `sector` = 228 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Silence Valley');--> statement-breakpoint
UPDATE `UserData` SET `sector` = 213, `longitude` = 13, `latitude` = 7 WHERE `sector` = 228 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Silence Valley');--> statement-breakpoint

UPDATE `Village` SET `sector` = 1133 WHERE `name` = 'The Legend of Vox Machina' AND `sector` = 145;--> statement-breakpoint
UPDATE `Sector` SET `sector` = 1133 WHERE `sector` = 145 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'The Legend of Vox Machina');--> statement-breakpoint
UPDATE `UserData` SET `sector` = 1133, `longitude` = 13, `latitude` = 7 WHERE `sector` = 145 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'The Legend of Vox Machina');--> statement-breakpoint

UPDATE `Village` SET `sector` = 156 WHERE `name` = 'Fallen Arcana' AND `sector` = 155;--> statement-breakpoint
UPDATE `Sector` SET `sector` = 156 WHERE `sector` = 155 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Fallen Arcana');--> statement-breakpoint
UPDATE `UserData` SET `sector` = 156, `longitude` = 13, `latitude` = 7 WHERE `sector` = 155 AND `villageId` = (SELECT `id` FROM `Village` WHERE `name` = 'Fallen Arcana');
