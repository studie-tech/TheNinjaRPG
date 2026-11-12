import { nanoid } from "nanoid";
import { WAR_SHRINE_IMAGE_BY_BIOME } from "@/drizzle/constants";
import type { VillageStructure } from "@/drizzle/schema";
import { WORLD_STRUCTURE_ART } from "@/libs/rendering/worldStructures";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { resolveSectorAnchor } from "@/libs/sector-map/validation";
import { getBiomeAtSectorAnchor } from "@/libs/travel";

/** Synthetic map structure with a fresh identity; longitude/latitude are local tile col/row. */
export const createGenericStructure = (info: {
  name: string;
  route: string;
  image: string;
  latitude: number;
  longitude: number;
}): VillageStructure => {
  return {
    id: nanoid(),
    name: info.name,
    route: info.route,
    image: info.image,
    worldArt: null,
    villageId: "unknown",
    longitude: info.longitude,
    latitude: info.latitude,
    hasPage: 1,
    showInVillagePage: false,
    curSp: 100,
    maxSp: 100,
    allyAccess: 1,
    level: 1,
    maxLevel: 1,
    lastUpgradedAt: new Date(),
    anbuSquadsPerLvl: 0,
    arenaRewardPerLvl: 0,
    bankInterestPerLvl: 0,
    blackDiscountPerLvl: 0,
    clansPerLvl: 0,
    hospitalSpeedupPerLvl: 0,
    itemDiscountPerLvl: 0,
    missionRewardPerLvl: 0,
    patrolsPerLvl: 0,
    ramenDiscountPerLvl: 0,
    regenIncreasePerLvl: 0,
    sleepRegenPerLvl: 0,
    structureDiscountPerLvl: 0,
    trainBoostPerLvl: 0,
    villageDefencePerLvl: 0,
    raidBoostExpiresAt: null,
    raidProtectedUntil: null,
    temporaryLevelBonus: 0,
    temporaryLevelBonusExpiresAt: null,
  };
};

/** The shrine's authored map position, with the shared unanchored-map fallback. */
export const getSectorShrinePosition = (map: Pick<NormalizedSectorMap, "anchors">) => {
  const anchor = resolveSectorAnchor(map, "shrine.default");
  return { x: anchor?.x ?? 10, y: anchor?.y ?? 5 };
};

/** Authored anchors and a shared identity keep sector state, rendered picking and shrine actions aligned. */
export const createShrineStructure = (
  map: NormalizedSectorMap,
  globalTileType: number,
) => {
  const anchor = getSectorShrinePosition(map);
  const art = Object.values(WORLD_STRUCTURE_ART).find(
    (art) => art.route === "/shrine" && art.sector === map.sector,
  );
  return {
    ...createGenericStructure({
      name: "Sector Shrine",
      route: "/shrine",
      image:
        art?.sourceImage ??
        WAR_SHRINE_IMAGE_BY_BIOME[
          getBiomeAtSectorAnchor(map, "shrine.default", globalTileType)
        ],
      longitude: anchor.x,
      latitude: anchor.y,
    }),
    id: "sector-shrine",
  };
};

/** A sector's structures plus the synthetic shrine, unless one already routes to /shrine. */
export const withSectorShrine = <T extends { route: string }>(
  structures: T[],
  map: NormalizedSectorMap,
  globalTileType: number,
): (T | ReturnType<typeof createShrineStructure>)[] =>
  structures.some((structure) => structure.route === "/shrine")
    ? structures
    : [...structures, createShrineStructure(map, globalTileType)];
