import { isDeepStrictEqual } from "node:util";
import { nanoid } from "nanoid";
import type { StructureArt } from "@/libs/rendering/worldStructures";
import { WORLD_STRUCTURE_ART } from "@/libs/rendering/worldStructures";
import { listMapAssetForGetAll, upsertMapAssetsForSeed } from "@/queries/mapAsset";
import {
  type StructurePresentation,
  selectStructuresForSeed,
  selectVillagesForStructureSeed,
  upsertStructuresForSeed,
} from "@/queries/villageStructures";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { chunkArray } from "@/utils/array";
import mapStructures from "../data/mapStructures.json";
import snapshot from "../data/villageStructures.json";

/** Apply published buildings to seeded settlements without copying production IDs or game state. */
export const seedPublishedBuildings = async (client: DrizzleClient) => {
  const definitions = snapshot as (StructurePresentation & {
    village: string;
    art: string | null;
    worldArt: StructureArt | null;
  })[];
  const names = [...new Set(definitions.map((entry) => entry.village))];
  const [villages, existing, mapAssets] = await Promise.all([
    selectVillagesForStructureSeed(client, names),
    selectStructuresForSeed(client, names),
    listMapAssetForGetAll(client),
  ]);
  const villagesByName = new Map(villages.map((entry) => [entry.name, entry.id]));
  const structures: (StructurePresentation & {
    id: string;
    villageId: string;
  })[] = [];
  const assets: ((typeof mapStructures)[number] & { id: string })[] = [];
  let inserted = 0;
  let updated = 0;
  let mapAssetsInserted = 0;
  let mapAssetsUpdated = 0;
  for (const { village, art, ...presentation } of definitions) {
    const villageId = villagesByName.get(village);
    if (!villageId) continue;
    if (art) {
      const published = WORLD_STRUCTURE_ART[art];
      if (!published) throw new Error(`Unknown published building artwork: ${art}`);
      const { village: _village, sector: _sector, ...worldArt } = published;
      presentation.worldArt = worldArt;
      presentation.image = worldArt.sourceImage;
    }
    const candidates = existing.filter(
      (entry) => entry.structure.villageId === villageId,
    );
    const saved =
      candidates.find((entry) => entry.structure.name === presentation.name)
        ?.structure ??
      (presentation.route
        ? candidates.find((entry) => entry.structure.route === presentation.route)
            ?.structure
        : undefined);
    if (saved) {
      const current = Object.fromEntries(
        Object.keys(presentation).map((key) => [key, saved[key as keyof typeof saved]]),
      );
      if (isDeepStrictEqual(current, presentation)) continue;
      updated++;
    } else {
      inserted++;
    }
    structures.push({ id: saved?.id ?? nanoid(), villageId, ...presentation });
  }
  for (const definition of mapStructures) {
    const saved = mapAssets.find((asset) => asset.key === definition.key);
    if (saved) {
      const current = Object.fromEntries(
        Object.keys(definition).map((key) => [key, saved[key as keyof typeof saved]]),
      );
      if (isDeepStrictEqual(current, definition)) continue;
      mapAssetsUpdated++;
    } else mapAssetsInserted++;
    assets.push({ id: saved?.id ?? nanoid(), ...definition });
  }
  await Promise.all([
    ...chunkArray(structures, 50).map((batch) =>
      retryOnDeadlock(() => upsertStructuresForSeed(client, batch)),
    ),
    ...chunkArray(assets, 50).map((batch) =>
      retryOnDeadlock(() => upsertMapAssetsForSeed(client, batch)),
    ),
  ]);
  return {
    villages: villages.length,
    inserted,
    updated,
    mapAssetsInserted,
    mapAssetsUpdated,
  };
};
