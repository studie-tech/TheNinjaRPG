import { randomInt } from "node:crypto";
import type { inferRouterOutputs } from "@trpc/server";
import { and, asc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import * as map from "@/data/hexasphere.json";
import {
  ANBU_STEALTH_BASE_CHANCE_PERC,
  ANBU_STEALTH_CHANGE_PER_LEVEL,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  ROBBING_IMMUNITY_DURATION,
  ROBBING_STOLLEN_AMOUNT,
  ROBBING_SUCCESS_CHANCE,
  ROBBING_VILLAGE_PRESTIGE_GAIN,
  SECTOR_HEIGHT,
  SECTOR_WIDTH,
  UserStatuses,
} from "@/drizzle/constants";
import {
  actionLog,
  clan,
  overworldAiPlacement,
  userData,
  village,
  war,
} from "@/drizzle/schema";
import { placementToSectorUser } from "@/libs/overworldAi";
import { calcLevel } from "@/libs/profile";
import { getServerPusher, updateUserOnMap } from "@/libs/pusher";
import {
  findNearestWalkableCoordinate,
  isReachableCoordinate,
  isWalkableCoordinate,
} from "@/libs/sector-map/validation";
import { isUserCurrentlyStealthed } from "@/libs/stealth";
import type { GlobalMapData } from "@/libs/threejs/types";
import {
  calcGlobalTravelTime,
  calcIsInVillage,
  findGlobalTravelDestination,
  maxDistance,
} from "@/libs/travel";
import { initiateBattle } from "@/routers/combat";
import { fetchUser } from "@/routers/profile";
import { breakStealth } from "@/routers/stealth";
import { fetchSector, fetchSectorVillage } from "@/routers/village";
import {
  fetchPublishedSectorMap,
  getSectorNeighborIds,
  resolveSectorCrossing,
} from "@/server/utils/sectorMap";
import { findRelationship } from "@/utils/alliance";
import { groupBy } from "@/utils/grouping";
import { secondsFromNow } from "@/utils/time";
import { getStrucBoost } from "@/utils/village";
import { sectorIdSchema, startGlobalMoveSchema } from "@/validators/travel";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  hasUserMiddleware,
  protectedProcedure,
  ratelimitMiddleware,
  serverError,
} from "../trpc";

// const redis = Redis.fromEnv();

const pusher = getServerPusher();

export const travelRouter = createTRPCRouter({
  // Rob another player
  robPlayer: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Rob another player for ryo" } })
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .input(
      z.object({
        // Coordinate bounds via zod (no sector-map read needed): the co-location
        // guards below require both robber and victim to stand on this exact tile,
        // and a player can only ever be on a walkable, in-bounds tile.
        longitude: z
          .int()
          .min(0)
          .max(SECTOR_WIDTH - 1),
        latitude: z
          .int()
          .min(0)
          .max(SECTOR_HEIGHT - 1),
        sector: sectorIdSchema,
        userId: z.string(),
      }),
    )
    .output(
      baseServerResponse.extend({
        battleId: z.string().optional(),
        money: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Query
      const [user, target, sectorData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
        ctx.drizzle.query.village.findFirst({
          where: eq(village.sector, input.sector),
        }),
      ]);

      // Guard
      if (!user.isOutlaw) return errorResponse("Only outlaws can rob other players");
      if (user.status !== "AWAKE") return errorResponse("You are not awake");
      if (user.isBanned) return errorResponse("You are banned");
      if (target.isBanned) return errorResponse("Target is banned");
      if (target.status !== "AWAKE")
        return errorResponse("Target cannot currently be robbed");
      if (user.clanId && target.clanId && user.clanId === target.clanId)
        return errorResponse("Cannot rob faction members");
      if (target.rank === "STUDENT" || target.rank === "GENIN") {
        return errorResponse("Cannot rob Academy Students or Genins");
      }
      // Special check for Wake Island - always block if sector is 222
      if (input.sector === 222) {
        return errorResponse("Cannot rob players in Wake Island");
      }

      if (sectorData?.pvpDisabled) {
        // Only protect members of the PvP-disabled village, not all users in the sector
        if (target.villageId === sectorData.id) {
          return errorResponse("Cannot rob players in this zone");
        }
      }
      if (target.robImmunityUntil && target.robImmunityUntil > new Date()) {
        return errorResponse("Target is immune from being robbed");
      }
      if (target.immunityUntil && target.immunityUntil > new Date()) {
        return errorResponse("Target is immune from being robbed");
      }

      // Level restrictions - prevent robbing users more than 15 levels under or above (skip if in war-torn sector)
      const isInWarTornSector = user.sector === MAP_WAR_TORN_BATTLEGROUND_SECTOR;
      if (!isInWarTornSector) {
        const robberLevel = calcLevel(user.experience);
        const targetLevel = calcLevel(target.experience);
        const levelDifference = robberLevel - targetLevel;

        if (levelDifference > 15) {
          return errorResponse(
            `Cannot rob ${target.username} - they are more than 15 levels below you (${levelDifference} level difference)`,
          );
        }

        if (levelDifference < -15) {
          return errorResponse(
            `Cannot rob ${target.username} - they are more than 15 levels above you (${Math.abs(levelDifference)} level difference)`,
          );
        }
      }

      if (
        target.sector !== input.sector ||
        target.longitude !== input.longitude ||
        target.latitude !== input.latitude
      ) {
        return errorResponse("Target is not in the specified location");
      }
      if (
        user.sector !== input.sector ||
        user.longitude !== input.longitude ||
        user.latitude !== input.latitude
      ) {
        return errorResponse("You are not in the correct sector");
      }

      // 40% chance to rob successfully
      const success = Math.random() < ROBBING_SUCCESS_CHANCE;

      if (success) {
        // Rob 30% of target's money
        const stolenAmount = Math.floor(target.money * ROBBING_STOLLEN_AMOUNT);

        // Break stealth first (if active) to avoid coupling with money operations
        if (user.stealthActive) {
          await breakStealth(ctx.drizzle, ctx.userId, user.stealth, false);
        }

        // Update robber first — if this fails, we bail out before touching anyone else
        const robberUpdate = await ctx.drizzle
          .update(userData)
          .set({
            money: sql`${userData.money} + ${stolenAmount}`,
            villagePrestige: sql`${userData.villagePrestige} + ${ROBBING_VILLAGE_PRESTIGE_GAIN}`,
          })
          .where(eq(userData.userId, ctx.userId));
        if (robberUpdate.rowsAffected === 0) {
          return errorResponse("Failed to update robber's data");
        }

        // Robber update succeeded — now update target and clan in parallel
        const [targetUpdate] = await Promise.all([
          ctx.drizzle
            .update(userData)
            .set({
              money: sql`${userData.money} - ${stolenAmount}`,
              robImmunityUntil: secondsFromNow(ROBBING_IMMUNITY_DURATION),
            })
            .where(eq(userData.userId, input.userId)),
          ...(user.clanId
            ? [
                ctx.drizzle
                  .update(clan)
                  .set({
                    points: sql`${clan.points} + 1`,
                    activityPoints: sql`${clan.activityPoints} + 1`,
                  })
                  .where(eq(clan.id, user.clanId)),
              ]
            : []),
        ]);

        if (targetUpdate && targetUpdate.rowsAffected === 0) {
          // Rollback robber update since target deduction failed
          await ctx.drizzle
            .update(userData)
            .set({
              money: sql`${userData.money} - ${stolenAmount}`,
              villagePrestige: sql`${userData.villagePrestige} - ${ROBBING_VILLAGE_PRESTIGE_GAIN}`,
            })
            .where(eq(userData.userId, ctx.userId));
          return errorResponse("Failed to update target's data");
        }

        // Log the action
        const logInsert = await ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: user.userId,
          tableName: "user",
          changes: [`Was robbed for ${stolenAmount} ryo by ${user.username}`],
          relatedId: user.userId,
          relatedMsg: `Was robbed by ${user.username}`,
          relatedImage: user.avatarLight,
        });
        if (logInsert.rowsAffected === 0) {
          // Non-critical error, continue but log it
          console.error("Failed to insert action log for robbery");
        }

        // Notify target (non-critical)
        await pusher.trigger(target.userId, "event", {
          type: "userMessage",
          message: `You've been robbed by ${user.username}`,
        });

        return {
          success: true,
          message: `Successfully robbed ${stolenAmount} money from ${target.username}!`,
          money: user.money + stolenAmount,
        };
      } else {
        // Failed rob attempt - break stealth first, then initiate combat
        // Sequential execution ensures initiateBattle sees correct stealth state
        // and avoids double stealth rolls
        if (user.stealthActive) {
          await breakStealth(ctx.drizzle, ctx.userId, user.stealth, false);
        }

        const battle = await initiateBattle(
          {
            longitude: input.longitude,
            latitude: input.latitude,
            sector: input.sector,
            userIds: [ctx.userId],
            targetIds: [input.userId],
            client: ctx.drizzle,
            biome: "default",
          },
          "COMBAT",
        );

        if (battle.success) {
          return {
            success: false,
            message: "Rob attempt failed! Prepare for combat!",
            battleId: battle.battleId,
          };
        } else {
          return {
            success: false,
            message: battle.message,
          };
        }
      }
    }),
  // Get users within a given sector
  getSectorData: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Get users and data within current sector" },
    })
    .input(z.object({ sector: sectorIdSchema })) // Note: this is not actively used, but is there for reloading the sector data
    .query(async ({ ctx }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);

      // Guard: Only awake/travel/queued users can scout
      // QUEUED is included so users in raid queues can still see war/sector data
      if (!["AWAKE", "TRAVEL", "QUEUED"].includes(user.status)) {
        return { users: [], village: null, sectorData: null, warData: null };
      }
      const [users, villageData, sectorData, warData, placements] = await Promise.all([
        ctx.drizzle.query.userData.findMany({
          columns: {
            userId: true,
            username: true,
            longitude: true,
            latitude: true,
            location: true,
            curHealth: true,
            maxHealth: true,
            sector: true,
            status: true,
            avatar: true,
            avatarLight: true,
            level: true,
            experience: true,
            rank: true,
            isOutlaw: true,
            isBanned: true,
            immunityUntil: true,
            robImmunityUntil: true,
            updatedAt: true,
            villageId: true,
            battleId: true,
            anbuId: true,
            stealthActive: true,
            stealthActivatedAt: true,
            stealth: true,
          },
          where: and(
            eq(userData.sector, user.sector),
            eq(userData.isAi, false),
            inArray(userData.status, ["AWAKE", "BATTLE"]),
            or(eq(userData.isBanned, false), eq(userData.userId, ctx.userId)),
            or(
              gte(userData.updatedAt, secondsFromNow(-36000)),
              eq(userData.userId, ctx.userId),
            ),
          ),
          with: {
            anbuSquad: {
              columns: {
                id: true,
                name: true,
                image: true,
                villageId: true,
              },
            },
          },
        }),
        ctx.drizzle.query.village.findFirst({
          where: and(
            eq(village.sector, user.sector),
            inArray(village.type, ["VILLAGE", "OUTLAW", "TOWN", "HIDEOUT", "SAFEZONE"]),
          ),
          with: { structures: true },
        }),
        fetchSector(ctx.drizzle, user.sector),
        ctx.drizzle.query.war.findMany({
          where: eq(war.status, "ACTIVE"),
          with: {
            attackerVillage: {
              columns: { name: true, id: true, villageGraphic: true, sector: true },
            },
            defenderVillage: {
              columns: { name: true, id: true, villageGraphic: true, sector: true },
            },
            warAllies: {
              columns: { villageId: true, supportVillageId: true },
            },
          },
        }),
        ctx.drizzle.query.overworldAiPlacement.findMany({
          where: and(
            eq(overworldAiPlacement.sector, user.sector),
            eq(overworldAiPlacement.isActive, true),
          ),
          // Stable order so the arrival-prompt `find`-first NPC can't flip between polls when two
          // placements share a tile (which would ping-pong the modal open on every sector refresh).
          orderBy: asc(overworldAiPlacement.id),
          columns: {
            id: true,
            aiTemplateUserId: true,
            interactionType: true,
            sector: true,
            longitude: true,
            latitude: true,
            positionVersion: true,
          },
          with: {
            aiTemplate: {
              columns: {
                userId: true,
                username: true,
                avatar: true,
                avatarLight: true,
                curHealth: true,
                maxHealth: true,
                level: true,
                rank: true,
                isAi: true,
              },
            },
          },
        }),
      ]);

      // Filter out stealthed players (unless it's the current user)
      // Then anonymize enemy ANBU squad members
      const processedUsers = users
        .filter((u) => {
          // Always show the current user
          if (u.userId === ctx.userId) return true;
          // Hide stealthed players from others (only if stealth hasn't expired)
          if (isUserCurrentlyStealthed(u)) {
            return false;
          }
          return true;
        })
        .map((u) => {
          if (u.anbuSquad && u.anbuSquad.villageId !== user.villageId) {
            return {
              ...u,
              username: `ANBU Member`,
              avatar: u.anbuSquad.image,
              avatarLight: u.anbuSquad.image,
            };
          }
          return u;
        });

      const overworldAis = placements
        .filter((p) => p.aiTemplate?.isAi)
        .map((p) => placementToSectorUser(p, p.aiTemplate!));

      return {
        users: processedUsers,
        village: villageData,
        sectorData,
        warData,
        overworldAis,
      };
    }),
  // Get village & alliance information for a given sector
  getVillageInSector: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Get village and alliance info for sector" },
    })
    .input(z.object({ sector: sectorIdSchema, isOutlaw: z.boolean().prefault(false) }))
    .query(async ({ input, ctx }) => {
      return await fetchSectorVillage(ctx.drizzle, input.sector, input.isOutlaw);
    }),
  // Initiate travel on the globe
  startGlobalMove: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Start global travel to another sector" },
    })
    .input(startGlobalMoveSchema)
    .output(
      baseServerResponse.extend({
        data: z
          .object({
            sector: z.number(),
            // Server-generated response coordinates, never client input.
            longitude: z.number(),
            latitude: z.number(),
            travelFinishAt: z.date(),
            status: z.enum(UserStatuses),
          })
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const targetTile = (map as unknown as GlobalMapData).tiles[input.sector];
      if (!targetTile) {
        return { success: false, message: "Target sector does not exist" };
      }
      // Fetch the user and destination in parallel. Global travel can begin
      // from any local tile; the target map only determines a safe landing.
      let [user, targetSectorMap] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchPublishedSectorMap(ctx.drizzle, input.sector).catch(() => null),
      ]);
      if (!targetSectorMap) {
        return errorResponse("The destination sector has no published map yet");
      }
      if (user.sector === input.sector) {
        return errorResponse("You are already in that sector");
      }
      if (user.status !== "AWAKE") {
        return { success: false, message: `Status is: ${user.status.toLowerCase()}` };
      }
      const departureSector = user.sector;
      const travelTime = calcGlobalTravelTime(
        departureSector,
        input.sector,
        map as unknown as GlobalMapData,
      );
      const endTime = secondsFromNow(travelTime);
      const destination = findGlobalTravelDestination(targetSectorMap, randomInt);
      if (!destination) {
        return errorResponse("The destination sector has no walkable tiles");
      }
      const result = await ctx.drizzle
        .update(userData)
        .set({
          sector: input.sector,
          longitude: destination.x,
          latitude: destination.y,
          status: "TRAVEL",
          travelFinishAt: endTime,
        })
        .where(
          and(
            eq(userData.userId, ctx.userId),
            eq(userData.status, "AWAKE"),
            eq(userData.sector, departureSector),
          ),
        );
      if (result.rowsAffected === 1) {
        user.sector = input.sector;
        user.longitude = destination.x;
        user.latitude = destination.y;
        user.status = "TRAVEL";
        user.travelFinishAt = endTime;
        // Only broadcast if user is NOT stealthed
        if (!isUserCurrentlyStealthed(user)) {
          void updateUserOnMap(pusher, user.sector, user);
        }
        return {
          success: true,
          message: "OK",
          data: {
            sector: input.sector,
            longitude: destination.x,
            latitude: destination.y,
            travelFinishAt: endTime,
            status: "TRAVEL",
          },
        };
      } else {
        user = await fetchUser(ctx.drizzle, ctx.userId);
        if (user.status !== "AWAKE") {
          return {
            success: false,
            message: `Status is: ${user.status.toLowerCase()}`,
          };
        } else if (user.sector !== departureSector) {
          return {
            success: false,
            message: "Your location changed; please try again",
          };
        } else {
          return { success: false, message: "Failed to start travel" };
        }
      }
    }),
  // Finish travel on the globe
  finishGlobalMove: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Complete global travel" } })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!["TRAVEL", "AWAKE"].includes(user.status)) {
        return {
          success: false,
          message: `Cannot finish travel because your status is: ${user.status.toLowerCase()}`,
        };
      }
      user.status = "AWAKE";
      user.travelFinishAt = null;
      // Only broadcast if user is NOT stealthed
      if (!isUserCurrentlyStealthed(user)) {
        void updateUserOnMap(pusher, user.sector, user);
      }
      await ctx.drizzle
        .update(userData)
        .set({ status: "AWAKE", travelFinishAt: null })
        .where(and(eq(userData.userId, ctx.userId), eq(userData.status, "TRAVEL")));
      return { success: true, message: "OK" };
    }),
  // Get all sector ownership
  getAllSectors: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get all sector ownership info" } })
    .query(async ({ ctx }) => {
      const allSectors = await ctx.drizzle.query.sector.findMany({
        columns: {
          sector: true,
          villageId: true,
        },
      });
      const groupedSectors = groupBy(allSectors, "villageId");
      const converted = [...groupedSectors.keys()].map((key) => {
        const sectors = groupedSectors.get(key) || [];
        return {
          villageId: key,
          sectors: sectors.map((s) => s.sector),
        };
      });
      return converted;
    }),
  /**
   * Move the user tile-by-tile within their sector, or one step across a
   * border into the adjacent aligned-grid sector via resolveSectorCrossing.
   * Snaps an unwalkable current tile to the nearest
   * walkable one, optionally carries destLongitude/destLatitude so a
   * cross-border walk commits in a single round trip, guards the position
   * update with a CAS WHERE clause, and broadcasts the move to both the
   * origin and target sectors.
   */
  moveInSector: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Move user within current sector" } })
    .input(
      z.object({
        curLongitude: z.int(),
        curLatitude: z.int(),
        longitude: z.int().min(-1),
        latitude: z.int().min(-1),
        destLongitude: z.int().min(0).nullish(),
        destLatitude: z.int().min(0).nullish(),
        sector: sectorIdSchema,
        villageId: z.string().nullish(),
        battleId: z.string().nullish(),
        level: z.int(),
        avatar: z.preprocess((val) => val || null, z.string().url().nullish()),
        avatarLight: z.preprocess((val) => val || null, z.string().url().nullish()),
        username: z.string(),
      }),
    )
    .output(
      baseServerResponse.extend(
        z.object({
          data: z
            .object({
              longitude: z.number(),
              latitude: z.number(),
              location: z.string(),
              username: z.string(),
              userId: z.string(),
              avatar: z.string().nullish(),
              avatarLight: z.string().nullish(),
              sector: z.number(),
              battleId: z.string().nullish(),
              villageId: z.string().nullish(),
              entryLongitude: z.number().optional(),
              entryLatitude: z.number().optional(),
            })
            .optional(),
        }).shape,
      ),
    )
    .mutation(async ({ input, ctx }) => {
      // Convenience
      const { longitude, latitude, sector, villageId } = input;
      const userId = ctx.userId;
      const userVillage = villageId ?? "syndicate";
      // Return a graceful response instead of a raw 500 if the sector has no
      // published map (mutations must return baseServerResponse per CLAUDE.md).
      const sectorMap = await fetchPublishedSectorMap(ctx.drizzle, sector).catch(
        () => null,
      );
      if (!sectorMap) return errorResponse("This sector has no published map yet");
      // If a republish blocked the tile the player is standing on, snap them to
      // the nearest walkable tile instead of locking them in place forever.
      const rawCurrent = { x: input.curLongitude, y: input.curLatitude };
      const current = isWalkableCoordinate(sectorMap, rawCurrent)
        ? rawCurrent
        : findNearestWalkableCoordinate(sectorMap, rawCurrent);
      if (!current) {
        return errorResponse("Your current location is not reachable");
      }
      const curLongitude = current.x;
      const curLatitude = current.y;
      // A target exactly one step beyond a border is a crossing into the
      // adjacent sector; the user must stand on the matching edge. Any other
      // sector transition must use global travel.
      const crossing = resolveAdjacentCrossing(
        sectorMap,
        { x: curLongitude, y: curLatitude },
        { x: longitude, y: latitude },
      );
      let targetSector = sector;
      let targetMap = sectorMap;
      let destination = { x: longitude, y: latitude };
      let entryTile: { x: number; y: number } | null = null;
      if (crossing) {
        if (!crossing.valid) return errorResponse(crossing.error);
        targetSector = getSectorNeighborIds(sector)[crossing.direction];
        if (targetSector < 0) {
          return errorResponse("The polar wastes block your path");
        }
        const neighbourMap = await fetchPublishedSectorMap(
          ctx.drizzle,
          targetSector,
        ).catch(() => null);
        if (!neighbourMap) {
          return errorResponse("The neighbouring sector has no published map yet");
        }
        targetMap = neighbourMap;
        // Cylindrical-grid neighbors are aligned and use the opposite entry
        // edge. Shared crossing math still adapts the rendered map's vertical
        // axis and maps proportionally if neighboring authored maps differ in size.
        const resolved = resolveSectorCrossing(
          sector,
          crossing.direction,
          curLongitude,
          curLatitude,
          sectorMap.width,
          sectorMap.height,
          targetMap.width,
          targetMap.height,
        );
        const entry = { x: resolved.entryX, y: resolved.entryY };
        entryTile = findNearestWalkableCoordinate(targetMap, entry) ?? entry;
        destination = entryTile;
        // A crossing may carry the journey's landing tile inside the new
        // sector, so one round trip commits the whole cross-border walk; the
        // client animates entry -> destination locally. An unreachable
        // request simply lands at the entry tile, matching what a separate
        // resume move would have produced.
        if (input.destLongitude != null && input.destLatitude != null) {
          const requested = { x: input.destLongitude, y: input.destLatitude };
          if (
            isWalkableCoordinate(targetMap, requested) &&
            isReachableCoordinate(targetMap, entryTile, requested)
          ) {
            destination = requested;
          }
        }
      } else {
        if (!isWalkableCoordinate(sectorMap, { x: longitude, y: latitude })) {
          return errorResponse("Target location is not reachable");
        }
        if (
          !isReachableCoordinate(
            sectorMap,
            { x: curLongitude, y: curLatitude },
            { x: longitude, y: latitude },
          )
        ) {
          return errorResponse("No reachable path to target location");
        }
      }
      const isVillage = calcIsInVillage(destination, targetMap);
      const location = isVillage ? "Village" : "";
      const travelLength =
        crossing && entryTile
          ? 1 +
            maxDistance({ longitude: entryTile.x, latitude: entryTile.y }, destination)
          : maxDistance(
              { longitude: curLongitude, latitude: curLatitude },
              destination,
            );
      // Optimistic update & query simultaneously
      const [user, result, sectorVillage] = await Promise.all([
        ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, userId),
          with: { anbuSquad: true },
        }),
        ctx.drizzle
          .update(userData)
          .set({
            sector: targetSector,
            longitude: destination.x,
            latitude: destination.y,
            location,
          })
          .where(
            and(
              eq(userData.userId, userId),
              eq(userData.status, "AWAKE"),
              eq(userData.sector, sector),
              // Guard on the player's ACTUAL stored position (the raw input),
              // not the snapped walkable coordinate — otherwise a snapped move
              // never matches the row and the player is soft-locked.
              eq(userData.longitude, input.curLongitude),
              eq(userData.latitude, input.curLatitude),
              villageId
                ? eq(userData.villageId, villageId)
                : isNull(userData.villageId),
            ),
          ),
        isVillage
          ? ctx.drizzle.query.village.findFirst({
              with: {
                structures: true,
                relationshipA: true,
                relationshipB: true,
              },
              where: eq(village.sector, targetSector),
            })
          : undefined,
      ]);
      // Check if move was successful
      if (result.rowsAffected === 1) {
        // Check for encounters / village defence
        if (isVillage && sectorVillage && sectorVillage.id !== userVillage) {
          const relations = [
            ...sectorVillage.relationshipA,
            ...sectorVillage.relationshipB,
          ];
          const relation = findRelationship(relations, userVillage, sectorVillage.id);
          if (relation?.status === "ENEMY") {
            // Chance of getting attacked by village protector
            const chance = getStrucBoost("patrolsPerLvl", sectorVillage.structures);
            if (Math.random() < (travelLength * chance) / 100) {
              // Chance of ANBU squad avoiding attack
              const anbuChance = user?.anbuId
                ? ANBU_STEALTH_BASE_CHANCE_PERC +
                  (user?.anbuSquad?.stealthLevel ?? 0) * ANBU_STEALTH_CHANGE_PER_LEVEL
                : 0;
              if (Math.random() < anbuChance / 100) {
                return {
                  success: true,
                  message: "ANBU stealth prevented guard attack",
                };
              }
              // Attack village protector
              const battle = await initiateBattle(
                {
                  longitude: destination.x,
                  latitude: destination.y,
                  sector: targetSector,
                  userIds: [ctx.userId],
                  targetIds: ["MJMzOE67Cx2YP3NX8SAbh"],
                  client: ctx.drizzle,
                  scaleTarget: true,
                  biome: "default",
                },
                "VILLAGE_PROTECTOR",
              );
              if (battle.success) {
                return { success: true, message: "Attacked by village protector" };
              }
            }
          }
        }
        // Final output
        const output = {
          ...input,
          sector: targetSector,
          longitude: destination.x,
          latitude: destination.y,
          location,
          userId: userId,
          status: "AWAKE" as const,
          ...(entryTile
            ? { entryLongitude: entryTile.x, entryLatitude: entryTile.y }
            : {}),
        };

        // Only broadcast if user is NOT stealthed (to hide from other players);
        // on a crossing the origin sector is told too so the user disappears.
        // experience/rank ride along so scouting can display the calc'd level.
        if (user && !isUserCurrentlyStealthed(user)) {
          const broadcast = {
            ...output,
            experience: user.experience,
            rank: user.rank,
          };
          void updateUserOnMap(pusher, targetSector, broadcast);
          if (targetSector !== sector) {
            void updateUserOnMap(pusher, sector, broadcast);
          }
        }
        return { success: true, message: "OK", data: output };
      } else {
        // Get the user data
        const user = await fetchUser(ctx.drizzle, userId);
        // Force an update on the map of the real information (only if not stealthed)
        if (!isUserCurrentlyStealthed(user)) {
          void updateUserOnMap(pusher, user.sector, user);
        }
        // Figure out return message
        if (user.status !== "AWAKE") {
          return errorResponse(`Status is: ${user.status.toLowerCase()}`);
        }
        if (user.sector !== sector) {
          return errorResponse("You are not in the correct sector");
        }
        if (user.longitude !== curLongitude || user.latitude !== curLatitude) {
          return errorResponse("You have moved since you started this move");
        }
        if (user.villageId !== villageId) {
          return errorResponse(
            "Seems like your village alliance has changed, please check profile.",
          );
        }
        throw serverError(
          "BAD_REQUEST",
          `Unknown error while moving. Route input: ${JSON.stringify(input)}. User information: ${JSON.stringify(
            {
              sector: user.sector,
              longitude: user.longitude,
              latitude: user.latitude,
              status: user.status,
              villageId: user.villageId,
            },
          )}`,
        );
      }
    }),
});

/**
 * Resolve whether a move targets the adjacent sector: the destination lies
 * exactly one step beyond one border of the map. Returns null for ordinary
 * in-sector moves; { valid: false } when a crossing is malformed (diagonal,
 * more than one step out, or the user is not on the matching edge).
 */
const resolveAdjacentCrossing = (
  map: { width: number; height: number },
  current: { x: number; y: number },
  target: { x: number; y: number },
):
  | { valid: true; direction: "north" | "east" | "south" | "west" }
  | { valid: false; error: string }
  | null => {
  const outWest = target.x === -1;
  const outEast = target.x === map.width;
  // Rendered sector coordinates increase upward: y=-1 is the visible south
  // edge and y=height is the visible north edge.
  const outSouth = target.y === -1;
  const outNorth = target.y === map.height;
  const outCount = [outWest, outEast, outNorth, outSouth].filter(Boolean).length;
  const inX = target.x >= 0 && target.x < map.width;
  const inY = target.y >= 0 && target.y < map.height;
  if (outCount === 0 && inX && inY) return null;
  if (outCount !== 1 || (!inX && !inY)) {
    return { valid: false, error: "Only adjacent sectors can be reached by walking" };
  }
  if (outNorth || outSouth) {
    const atEdge = outNorth ? current.y === map.height - 1 : current.y === 0;
    if (!atEdge || target.x !== current.x) {
      return { valid: false, error: "You must be at the matching edge to cross over" };
    }
    return { valid: true, direction: outNorth ? "north" : "south" };
  }
  const atEdge = outWest ? current.x === 0 : current.x === map.width - 1;
  if (!atEdge || target.y !== current.y) {
    return { valid: false, error: "You must be at the matching edge to cross over" };
  }
  return { valid: true, direction: outWest ? "west" : "east" };
};

type RouterOutput = inferRouterOutputs<typeof travelRouter>;
export type SectorVillage = RouterOutput["getSectorData"]["village"];
