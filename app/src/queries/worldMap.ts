/**
 * Database access for world map; authorization and transaction scopes stay in callers.
 */
import { and, eq, inArray, lt, type SQL, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  actionLog,
  dungeon,
  mapAsset,
  overworldAiPlacement,
  quest,
  sectorMap,
  villageStructure,
} from "@/drizzle/schema";
import { mergeTerrainSpecs } from "@/libs/sector-map/terrains";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import type { DrizzleClient } from "@/server/db";

/** Build the `quest` listing for `fetchPublicQuestLocations`, using predicates on `publicLocations` and `hidden`. */
export const listQuestForFetchPublicQuestLocations = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.quest.findMany({
    columns: { id: true, content: true, hidden: true, startsAt: true, endsAt: true },
    where: and(eq(quest.publicLocations, true), eq(quest.hidden, false)),
  });

/** Build the `mapAsset` listing for `validateQuestStructures`, selecting only `id`, using predicates on `id`. */
export const listMapAssetForValidateQuestStructures = (
  client: Pick<DrizzleClient, "query">,
  ids: string[],
) =>
  client.query.mapAsset.findMany({
    columns: { id: true },
    where: inArray(mapAsset.id, ids),
  });

/** Build the `overworldAiPlacement` listing for `validateQuestStructures`, using predicates on `id`. */
export const listOverworldAiPlacementForValidateQuestStructures = (
  client: Pick<DrizzleClient, "query">,
  placementIds: string[],
) =>
  client.query.overworldAiPlacement.findMany({
    where: inArray(overworldAiPlacement.id, placementIds),
  });

/** Build the `quest` lookup for `isStructureAssetUsed`, selecting only `id`, using predicates on `content`. */
export const findQuestForIsStructureAssetUsed = (
  client: Pick<DrizzleClient, "query">,
  assetId: string,
) =>
  client.query.quest.findFirst({
    columns: { id: true },
    where: sql`JSON_CONTAINS(JSON_EXTRACT(${quest.content}, '$.objectives[*].structureAssetId'), JSON_QUOTE(${assetId})) = 1`,
  });

/** Build the `dungeon` lookup for `isStructureAssetUsed`, selecting only `id`, using predicates on `content`. */
export const findDungeonForIsStructureAssetUsed = (
  client: Pick<DrizzleClient, "query">,
  assetId: string,
) =>
  client.query.dungeon.findFirst({
    columns: { id: true },
    where: sql`JSON_UNQUOTE(JSON_EXTRACT(${dungeon.content}, '$.structureAssetId')) = ${assetId}`,
  });

/** Normalized map, version and read timestamp retained for published-map cache checks. */
type PublishedMapCacheEntry = { map: NormalizedSectorMap; version: number; at: number };

/**
 * Build the `sectorMap` listing for `fetchPublishedSectorMaps`, selecting only
 * `sector` and `version`, using predicates on `sector` and `status`.
 */
export const listSectorMapForFetchPublishedSectorMaps = (
  client: Pick<DrizzleClient, "query">,
  expired: Map<number, PublishedMapCacheEntry>,
) =>
  client.query.sectorMap.findMany({
    columns: { sector: true, version: true },
    where: and(
      inArray(sectorMap.sector, [...expired.keys()]),
      eq(sectorMap.status, "PUBLISHED"),
    ),
  });

/** Build the `sectorMap` lookup for `fetchUncachedPublishedMaps`, using the configured predicates. */
export const findSectorMapForFetchUncachedPublishedMaps = (
  client: Pick<DrizzleClient, "query">,
  columns: { sector: true; version: true; normalizedJson: true },
  where: undefined | SQL<unknown>,
) =>
  client.query.sectorMap.findFirst({
    columns,
    where,
    orderBy: (table, { desc }) => [desc(table.version)],
  });

/** Build the `sectorMap` listing for `fetchUncachedPublishedMaps`, using the configured predicates. */
export const listSectorMapForFetchUncachedPublishedMaps = (
  client: Pick<DrizzleClient, "query">,
  columns: { sector: true; version: true; normalizedJson: true },
  where: undefined | SQL<unknown>,
) => client.query.sectorMap.findMany({ columns, where });

/** The full terrain registry (built-ins overlaid with the MapTerrain library) */
export const fetchTerrainRegistry = async (client: DrizzleClient) => {
  const rows = await client.query.mapTerrain.findMany({
    columns: {
      key: true,
      name: true,
      colors: true,
      textureUrl: true,
      swatchColor: true,
      battleBiome: true,
      isWater: true,
      depression: true,
      defaultWalkCost: true,
    },
  });
  return mergeTerrainSpecs(rows);
};

/** Build the `sectorMap` listing for `listSectorMaps`, using the configured predicates. */
export const listSectorMapForListSectorMaps = (
  client: Pick<DrizzleClient, "query">,
  conditions: SQL<unknown>[],
) =>
  client.query.sectorMap.findMany({
    columns: {
      id: true,
      sector: true,
      name: true,
      width: true,
      height: true,
      status: true,
      version: true,
      sourceHash: true,
      publishedAt: true,
      publishedByUserId: true,
      createdAt: true,
      updatedAt: true,
    },
    with: {
      publishedBy: {
        columns: {
          userId: true,
          username: true,
        },
      },
    },
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  });

/** Build the `sectorMap` lookup for `getSectorMapById`, using predicates on `id`. */
export const findSectorMapForGetSectorMapById = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.sectorMap.findFirst({
    where: eq(sectorMap.id, input.id),
  });

/** Build the `sectorMap` insert for `saveTiledSectorMap`. */
export const insertSectorMapForSaveTiledSectorMap = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  input: { sector: number; name: string; tiledJson: unknown; publish: false | true },
  normalizedMap: import("@/libs/sector-map/types").NormalizedSectorMap,
  status: "DRAFT" | "PUBLISHED",
  version: number,
  sourceHash: string,
  now: Date,
  ctx: { userId: string },
) =>
  client.insert(sectorMap).values({
    id,
    sector: input.sector,
    name: input.name,
    width: normalizedMap.width,
    height: normalizedMap.height,
    status,
    version,
    sourceHash,
    rawTiledJson: input.tiledJson,
    normalizedJson: normalizedMap,
    publishedAt: input.publish ? now : null,
    publishedByUserId: input.publish ? ctx.userId : null,
    createdAt: now,
    updatedAt: now,
  });

/** Build the update archiving a sector's published maps below `version`. */
export const archiveOlderPublishedSectorMaps = (
  client: Pick<DrizzleClient, "update">,
  now: Date,
  input: { sector: number },
  version: number,
) =>
  client
    .update(sectorMap)
    .set({ status: "ARCHIVED", updatedAt: now })
    .where(
      and(
        eq(sectorMap.sector, input.sector),
        eq(sectorMap.status, "PUBLISHED"),
        lt(sectorMap.version, version),
      ),
    );

/** Build the `sectorMap` lookup for `publishSectorMap`, using predicates on `id`. */
export const findSectorMapForPublishSectorMap = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.sectorMap.findFirst({
    columns: { sector: true, name: true, sourceHash: true, rawTiledJson: true },
    where: eq(sectorMap.id, input.id),
  });

/** Build the `sectorMap` update for `publishSectorMap`, using predicates on `id`. */
export const updateSectorMapForPublishSectorMap = (
  client: Pick<DrizzleClient, "update">,
  version: number,
  result: { map: import("@/libs/sector-map/types").NormalizedSectorMap },
  now: Date,
  ctx: { userId: string },
  input: { id: string },
) =>
  client
    .update(sectorMap)
    .set({
      status: "PUBLISHED",
      version,
      normalizedJson: result.map,
      width: result.map.width,
      height: result.map.height,
      publishedAt: now,
      publishedByUserId: ctx.userId,
      updatedAt: now,
    })
    .where(eq(sectorMap.id, input.id));

/** Build the `sectorMap` update for `archiveSectorMap`, setting `status` and `updatedAt`, using predicates on `id`. */
export const updateSectorMapForArchiveSectorMap = (
  client: Pick<DrizzleClient, "update">,
  input: { id: string },
) =>
  client
    .update(sectorMap)
    .set({ status: "ARCHIVED", updatedAt: new Date() })
    .where(eq(sectorMap.id, input.id));

/** Build the `villageStructure` lookup for `moveStructure`, using predicates on `id`. */
export const findVillageStructureForMoveStructure = (
  client: Pick<DrizzleClient, "query">,
  input: { structureId: string },
) =>
  client.query.villageStructure.findFirst({
    where: eq(villageStructure.id, input.structureId),
    with: { village: { with: { structures: true } } },
  });

/**
 * Build the `villageStructure` update for `moveStructure`, setting `longitude` and
 * `latitude`, using predicates on `id`, `longitude`, `latitude`.
 */
export const updateVillageStructureForMoveStructure = (
  client: Pick<DrizzleClient, "update">,
  input: { longitude: number; latitude: number },
  structure: { id: string; longitude: number; latitude: number },
) =>
  client
    .update(villageStructure)
    .set({ longitude: input.longitude, latitude: input.latitude })
    .where(
      and(
        eq(villageStructure.id, structure.id),
        eq(villageStructure.longitude, structure.longitude),
        eq(villageStructure.latitude, structure.latitude),
      ),
    );

/** Build the `actionLog` insert for `moveStructure`. */
export const insertActionLogForMoveStructure = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  structure: { name: string; village: { name: string }; id: string; image: string },
  from: string,
  to: string,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "villageStructure",
    changes: [
      `Moved ${structure.name} of ${structure.village.name} from ${from} to ${to}`,
    ],
    relatedId: structure.id,
    relatedMsg: `Move: ${structure.name}`,
    relatedImage: structure.image,
  });

/** Build the `sectorMap` lookup for `getNextSectorMapVersion`, selecting only `version`, using predicates on `sector`. */
export const findSectorMapForGetNextSectorMapVersion = (
  client: Pick<DrizzleClient, "query">,
  sector: number,
) =>
  client.query.sectorMap.findFirst({
    columns: { version: true },
    where: eq(sectorMap.sector, sector),
    orderBy: (table, { desc }) => [desc(table.version)],
  });

/** Build the faction-filtered village and structure listing for world-map sector windows. */
export const listVillagesForSectorWindow = (
  client: Pick<DrizzleClient, "query">,
  sectors: number[],
) =>
  client.query.village.findMany({
    // Same faction filter as travel.getSectorData, so a sector renders the
    // same buildings whether it is the window center or a neighbor
    where: (table, { and, inArray }) =>
      and(
        inArray(table.sector, sectors),
        inArray(table.type, ["VILLAGE", "OUTLAW", "STRONGHOLD", "HIDEOUT", "SAFEZONE"]),
      ),
    with: { structures: true },
  });
