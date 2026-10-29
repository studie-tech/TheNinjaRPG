import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { type SectorMapStatus, SectorMapStatuses } from "@/drizzle/constants";
import { sectorMap } from "@/drizzle/schema";
import { normalizeTiledSectorMap } from "@/libs/sector-map/tiled";
import {
  isVillageStructurePlacementAllowed,
  usesVillageWalls,
} from "@/libs/sector-map/village-walls";
import { fetchUser } from "@/queries/profile";
import {
  fetchTerrainRegistry,
  findSectorMapForGetNextSectorMapVersion,
  findSectorMapForGetSectorMapById,
  findSectorMapForPublishSectorMap,
  findVillageStructureForMoveStructure,
  insertActionLogForMoveStructure,
  insertSectorMapForSaveTiledSectorMap,
  listSectorMapForListSectorMaps,
  updateSectorMapForArchiveSectorMap,
  updateSectorMapForPublishSectorMap,
  updateSectorMapForSaveTiledSectorMap,
  updateVillageStructureForMoveStructure,
} from "@/queries/worldMap";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import {
  fetchPublicQuestLocations,
  validateMapLocationTiles,
} from "@/server/utils/mapLocations";
import {
  buildSectorWindowLayout,
  fetchPublishedSectorMaps,
  fetchSectorWindowEntries,
  getSectorNeighborIds,
  invalidatePublishedMapCache,
} from "@/server/utils/sectorMap";

import { canChangeContent } from "@/utils/permissions";
// Reuse the centralized sector-id bounds instead of redefining them here
import { sectorIdSchema as sectorSchema } from "@/validators/travel";

const sectorMapStatusSchema = z.enum(SectorMapStatuses);

export const worldMapRouter = createTRPCRouter({
  /**
   * List sector map rows for the editor (content staff only). Returns metadata
   * columns only — the raw/normalized JSON blobs are deliberately excluded to
   * keep the listing light. Optional sector/status filters run in SQL against
   * the SectorMap_sector_status_idx index.
   */
  listSectorMaps: protectedProcedure
    .input(
      z
        .object({
          sector: sectorSchema.optional(),
          status: sectorMapStatusSchema.optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      // Filter in SQL (uses the SectorMap_sector_status_idx index) instead of
      // scanning the whole ever-growing table and filtering in JS. Conditions
      // derive only from input, so the listing can run parallel with the auth
      // guard (metadata-only columns, so no heavy blobs leak before the check).
      const conditions = [
        input?.sector !== undefined ? eq(sectorMap.sector, input.sector) : undefined,
        input?.status ? eq(sectorMap.status, input.status) : undefined,
      ].filter((condition) => condition !== undefined);
      // Query + guard (parallel: the user fetch and the metadata listing)
      const [user, rows] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        listSectorMapForListSectorMaps(ctx.drizzle, conditions),
      ]);
      if (user.isBanned) throw serverError("FORBIDDEN", "You are banned");
      if (!canChangeContent(user.role)) throw serverError("FORBIDDEN", "Not allowed");
      return rows;
    }),

  /**
   * Player-facing 3x3 sector window: published maps and village structures for
   * the center sector plus its neighbors. The asset/terrain libraries do NOT
   * ride along (fetch them once per session via mapAsset.getAll and
   * mapTerrain.getAll); instead the response carries windowLayouts — the pure
   * topology of the center's and each cardinal neighbor's window — so the
   * client can assemble crossed-into windows locally from per-sector data
   * (getSectorEntries) without re-downloading maps it already holds.
   * Throws only when the CENTER sector lacks a published map; missing neighbors
   * and diagonals are silently omitted from the response.
   */
  getSectorWindow: protectedProcedure
    .input(z.object({ sector: sectorSchema }))
    .query(async ({ ctx, input }) => {
      // Derived: the 3x3 window around the sector (dx/dy grid offsets + seam
      // rotations); see buildSectorWindowLayout for the layout semantics
      const windowLayouts = buildWindowLayoutBundle(input.sector);
      const layout = windowLayouts[0]?.entries ?? [];
      // Query
      const entries = await fetchSectorWindowEntries(
        ctx.drizzle,
        layout.map((entry) => entry.sector),
      );
      return {
        center: input.sector,
        windowLayouts,
        sectors: layout.flatMap((entry) => {
          const data = entries.get(entry.sector);
          if (!data) {
            // The center must always have a published map. A missing neighbor or
            // diagonal just renders as an empty edge — a published map can
            // briefly lag during a publish, and cube-edge windows already omit
            // off-grid sectors — so skip it instead of failing the whole window
            // and soft-bricking travel for the sector the player stands on.
            if (entry.sector === input.sector) {
              throw serverError(
                "NOT_FOUND",
                `No published sector map for sector ${entry.sector}`,
              );
            }
            return [];
          }
          return [{ ...entry, ...data }];
        }),
      };
    }),

  /**
   * Warm-up fetch for the sectors surrounding the player's current window:
   * returns per-sector map data for every sector in the center's and its
   * cardinal neighbors' windows that the client does not already hold
   * (`known`), plus the window layouts needed to assemble those neighbor
   * windows client-side after a border crossing. Sectors without a published
   * map are echoed in missingSectors so the client caches the absence instead
   * of re-requesting them on every crossing.
   */
  getSectorEntries: protectedProcedure
    .input(
      z.object({
        center: sectorSchema,
        known: z.array(sectorSchema).max(64).default([]),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Derived: union of the center's + cardinal neighbors' window sectors,
      // minus everything the client already holds
      const windowLayouts = buildWindowLayoutBundle(input.center);
      const known = new Set(input.known);
      const wanted = [
        ...new Set(
          windowLayouts.flatMap((window) => window.entries.map((e) => e.sector)),
        ),
      ].filter((sector) => !known.has(sector));
      // Query
      const entries =
        wanted.length > 0
          ? await fetchSectorWindowEntries(ctx.drizzle, wanted)
          : new Map<number, never>();
      return {
        center: input.center,
        windowLayouts,
        entries: [...entries.values()],
        missingSectors: wanted.filter((sector) => !entries.has(sector)),
      };
    }),

  /**
   * Full sector map row including the heavy rawTiledJson and normalizedJson
   * blobs — editor use only (content staff).
   */
  getSectorMapById: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      // Guard (kept before the query: the row carries heavy raw/normalized JSON
      // blobs we don't want to fetch for an unauthorized caller)
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned) throw serverError("FORBIDDEN", "You are banned");
      if (!canChangeContent(user.role)) throw serverError("FORBIDDEN", "Not allowed");
      // Query
      const map = await findSectorMapForGetSectorMapById(ctx.drizzle, input);
      if (!map) throw serverError("NOT_FOUND", "Map does not exist");
      return map;
    }),

  /**
   * Dry-run validation of a Tiled JSON upload against the terrain registry.
   * Never writes to the database; success simply means the normalization
   * produced zero errors (warnings may still be present).
   */
  previewTiledSectorMap: protectedProcedure
    .input(
      z.object({
        sector: sectorSchema,
        name: z.string().min(1).max(191),
        tiledJson: z.unknown(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Queries (parallel: editor identity + terrain registry)
      const [user, terrainRegistry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchTerrainRegistry(ctx.drizzle),
      ]);
      // Guards
      if (user.isBanned) return errorResponse("You are banned");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");

      // Dry-run normalization against the terrain registry; never writes
      const result = normalizeTiledSectorMap({
        sector: input.sector,
        name: input.name,
        tiledJson: input.tiledJson,
        terrainRegistry,
      });

      return {
        success: result.errors.length === 0,
        message: result.errors.length === 0 ? "Map is valid" : "Map is invalid",
        errors: result.errors,
        warnings: result.warnings,
        map: result.map,
      };
    }),

  /**
   * Normalize a Tiled JSON upload and insert it as a NEW versioned row, either
   * as a draft or published immediately. When publishing, the new row is
   * inserted before older published rows are archived, so a failed insert
   * leaves the existing map live. Only strictly-older versions are archived
   * so concurrent publishes cannot archive each other.
   */
  saveTiledSectorMap: protectedProcedure
    .input(
      z.object({
        sector: sectorSchema,
        name: z.string().min(1).max(191),
        publish: z.boolean().default(false),
        tiledJson: z.unknown(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch independent publication inputs together, including scheduled public
      // entrances so a new map cannot block landmarks when their event starts.
      const [user, terrainRegistry, version, locations] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchTerrainRegistry(ctx.drizzle),
        getNextSectorMapVersion(ctx.drizzle, input.sector),
        input.publish
          ? fetchPublicQuestLocations(ctx.drizzle, {
              fresh: true,
              includeScheduled: true,
            })
          : [],
      ]);
      // Guards
      if (user.isBanned) return errorResponse("You are banned");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");

      // Derived: normalize the upload; abort with the validation errors if invalid
      const sourceHash = hashTiledJson(input.tiledJson);
      const result = normalizeTiledSectorMap({
        sector: input.sector,
        name: input.name,
        sourceHash,
        tiledJson: input.tiledJson,
        terrainRegistry,
      });
      if (!result.map) {
        return {
          success: false,
          message: "Map is invalid",
          errors: result.errors,
          warnings: result.warnings,
        };
      }

      const normalizedMap = result.map;
      const status: SectorMapStatus = input.publish ? "PUBLISHED" : "DRAFT";
      const locationError = validateMapLocationTiles(
        locations.filter((location) => location.sector === input.sector),
        new Map([[input.sector, result.map]]),
      );
      if (locationError) return errorResponse(locationError);
      const id = nanoid();
      const now = new Date();

      // Mutation: insert the new version FIRST, then (if publishing) archive the
      // previously-published rows for this sector. A failed insert leaves the
      // existing map live; readers pick the highest version if two briefly overlap
      // (fetchPublishedSectorMaps).
      // A same-version race collides on the unique index and is caught below.
      try {
        await insertSectorMapForSaveTiledSectorMap(
          ctx.drizzle,
          id,
          input,
          normalizedMap,
          status,
          version,
          sourceHash,
          now,
          ctx,
        );
      } catch {
        return errorResponse(
          "A newer version was saved at the same time. Please reload and try again.",
        );
      }
      if (input.publish) {
        // Archive only strictly-older published rows. The new row has the
        // highest version, so a concurrent publish (which gets an even higher
        // version) is never archived by this query — preventing two concurrent
        // publishes from archiving each other and leaving the sector unpublished.
        await updateSectorMapForSaveTiledSectorMap(ctx.drizzle, now, input, version);
        invalidatePublishedMapCache(input.sector);
      }

      return {
        success: true,
        message: input.publish ? "Map published" : "Map saved as draft",
        id,
        version,
        errors: result.errors,
        warnings: result.warnings,
        map: normalizedMap,
      };
    }),

  /**
   * Promote an EXISTING row to published (including re-publishing an older
   * version). The row's raw Tiled JSON is re-normalized through the current
   * importer first, so republishing also picks up importer improvements.
   * Promotes to a new highest version before archiving strictly-older
   * published rows, so a failed promotion leaves the existing published map live.
   */
  publishSectorMap: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Fetch the candidate, terrain registry and all public entrances together;
      // future event entrances must remain reachable on the promoted map too.
      const [user, candidate, terrainRegistry, locations] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findSectorMapForPublishSectorMap(ctx.drizzle, input),
        fetchTerrainRegistry(ctx.drizzle),
        fetchPublicQuestLocations(ctx.drizzle, { fresh: true, includeScheduled: true }),
      ]);
      if (user.isBanned) return errorResponse("You are banned");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      if (!candidate) return errorResponse("Map does not exist");

      // Derived: re-normalize the stored raw through the CURRENT importer, so
      // promoting an older version also picks up importer improvements (the
      // stored normalizedJson is a snapshot from whenever the row was saved)
      const result = normalizeTiledSectorMap({
        sector: candidate.sector,
        name: candidate.name,
        tiledJson: candidate.rawTiledJson,
        terrainRegistry,
      });
      if (!result.map) {
        return errorResponse(
          `This version no longer passes import validation: ${result.errors.slice(0, 3).join("; ")}`,
        );
      }

      const locationError = validateMapLocationTiles(
        locations.filter((location) => location.sector === candidate.sector),
        new Map([[candidate.sector, result.map]]),
      );
      if (locationError) return errorResponse(locationError);
      const now = new Date();
      // Mutation: promote this map to a NEW highest version FIRST, then archive strictly-
      // older published rows. Bumping to the top version makes this compose
      // with saveTiledSectorMap (which also
      // archives version < its own new version): the globally-highest published
      // row is never archived by anyone, so concurrent publishes can never leave
      // the sector with zero published maps. Re-publishing an older version still
      // works — it becomes the new highest and everything below is archived.
      const version = await getNextSectorMapVersion(ctx.drizzle, candidate.sector);
      try {
        await updateSectorMapForPublishSectorMap(
          ctx.drizzle,
          version,
          { map: result.map },
          now,
          ctx,
          input,
        );
      } catch {
        return errorResponse(
          "Another version was published at the same time. Please retry.",
        );
      }
      await updateSectorMapForSaveTiledSectorMap(ctx.drizzle, now, candidate, version);
      invalidatePublishedMapCache(candidate.sector);

      return { success: true, message: "Map published" };
    }),

  /**
   * Archive a sector map row. Unlike publishing, this may intentionally leave
   * the sector with no published map (admin escape hatch), so it clears the
   * entire published-map cache rather than a single sector.
   */
  archiveSectorMap: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Guards
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned) return errorResponse("You are banned");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");

      // Mutation (rowsAffected doubles as the existence check)
      const result = await updateSectorMapForArchiveSectorMap(ctx.drizzle, input);
      if (result.rowsAffected === 0) return errorResponse("Map does not exist");
      // Archiving may unpublish a sector; clear the whole cache (rare admin op).
      invalidatePublishedMapCache();
      return { success: true, message: "Map archived" };
    }),

  /**
   * Admin drag-and-drop relocation of a village structure. Validates the
   * target tile is inside the sector's published map bounds and unoccupied,
   * then guards the UPDATE on the structure's previously-read position
   * (compare-and-swap) to reject stale moves, and only writes the actionLog
   * audit entry if the move actually happened.
   */
  moveStructure: protectedProcedure
    .input(
      z.object({
        structureId: z.string().min(1),
        longitude: z.number().int().min(0),
        latitude: z.number().int().min(0),
      }),
    )
    .output(
      baseServerResponse.extend({
        structure: z
          .object({
            id: z.string(),
            villageId: z.string(),
            longitude: z.number(),
            latitude: z.number(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query + guard (parallel: the user fetch and the structure lookup keyed
      // on input.structureId — no dependency between them)
      const [user, structure] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findVillageStructureForMoveStructure(ctx.drizzle, input),
      ]);
      if (user.isBanned) return errorResponse("You are banned");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      if (!structure?.village) return errorResponse("Structure not found");

      // Guards: the target tile must be inside the sector's published map bounds
      // and not already occupied by another structure (the map read genuinely
      // depends on the structure's sector, so it stays sequential here)
      const maps = await fetchPublishedSectorMaps(ctx.drizzle, [
        structure.village.sector,
      ]);
      const map = maps.get(structure.village.sector);
      if (!map) return errorResponse("The village sector has no published map");
      if (input.longitude >= map.width || input.latitude >= map.height) {
        return errorResponse(
          `Target tile is outside the ${map.width}x${map.height} sector map`,
        );
      }
      if (
        usesVillageWalls(structure.village.type) &&
        !isVillageStructurePlacementAllowed(map, {
          x: input.longitude,
          y: input.latitude,
        })
      ) {
        return errorResponse(
          "Structures must stay at least three hexes away from the sector border",
        );
      }
      const occupant = structure.village.structures.find(
        (candidate) =>
          candidate.id !== structure.id &&
          candidate.longitude === input.longitude &&
          candidate.latitude === input.latitude,
      );
      if (occupant) {
        return errorResponse(`That tile is already occupied by ${occupant.name}`);
      }

      const from = `(${structure.longitude}, ${structure.latitude})`;
      const to = `(${input.longitude}, ${input.latitude})`;
      // CAS on the previously-read position rejects a stale move: if the row was
      // deleted or moved since we read it, the update matches nothing and we skip
      // the audit log rather than record a move that never happened.
      const moved = await updateVillageStructureForMoveStructure(
        ctx.drizzle,
        input,
        structure,
      );
      if (moved.rowsAffected === 0) {
        return errorResponse(
          "The structure changed since you loaded it; reload and try again",
        );
      }
      await insertActionLogForMoveStructure(ctx.drizzle, ctx, structure, from, to);
      return {
        success: true,
        message: `${structure.name} moved to ${to}`,
        structure: {
          id: structure.id,
          villageId: structure.villageId,
          longitude: input.longitude,
          latitude: input.latitude,
        },
      };
    }),
});

/** COMMON QUERIES WHICH ARE REUSED */

/**
 * Window layouts (pure topology, no DB) for a center sector and each of its
 * on-grid cardinal neighbors — the windows a player standing in `sector` can
 * see now or cross into next. The CENTER's layout is always first.
 */
const buildWindowLayoutBundle = (sector: number) => {
  const cardinals = getSectorNeighborIds(sector);
  return [sector, cardinals.north, cardinals.east, cardinals.south, cardinals.west]
    .filter((center) => center >= 0)
    .map((center) => ({ center, entries: buildSectorWindowLayout(center) }));
};

/**
 * sha256 hex digest of the JSON.stringify'd upload, used as the default
 * sourceHash when the client supplies none. Not canonicalized, so the same
 * logical document with different key ordering hashes differently.
 */
const hashTiledJson = (json: unknown) => {
  return createHash("sha256").update(JSON.stringify(json)).digest("hex");
};

/**
 * Next candidate version for a sector: max(version) + 1. The read and subsequent
 * write are separate; the unique (sector, version) index rejects a same-version
 * race, which callers report as a retryable conflict. Readers select the highest
 * version when different published versions briefly overlap.
 */
const getNextSectorMapVersion = async (client: DrizzleClient, sector: number) => {
  const latest = await findSectorMapForGetNextSectorMapVersion(client, sector);
  return (latest?.version ?? 0) + 1;
};
