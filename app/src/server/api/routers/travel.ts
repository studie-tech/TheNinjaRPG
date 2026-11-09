import { randomInt } from "node:crypto";
import type { inferRouterOutputs } from "@trpc/server";
import { and, eq, gt, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import * as map from "@/data/hexasphere.json";
import { getFinishGlobalMoveUserUpdate, getRobPlayerUserUpdate } from "@/deltas/travel";
import {
  IMG_AVATAR_DEFAULT,
  MAP_WAKE_ISLAND_SECTOR,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  REGEN_SECONDS,
  ROBBING_MAX_LEVEL_DIFFERENCE,
  ROBBING_STOLLEN_AMOUNT,
  ROBBING_SUCCESS_CHANCE,
  ROBBING_VILLAGE_PRESTIGE_GAIN,
  TUTORIAL_GENIN_EXAM_QUEST_ID,
  TUTORIAL_STARTER_QUEST_ID,
  UserStatuses,
  VILLAGE_PROTECTOR_AI_ID,
} from "@/drizzle/constants";
import { type UserData, userData } from "@/drizzle/schema";
import { anbuStealthChance } from "@/libs/anbu";
import { isCreator } from "@/libs/combat/creatorTrial";
import {
  anonymousSpriteAppearance,
  resolveSpriteAppearance,
} from "@/libs/lpc/appearance";
import { getQuestMapLocations } from "@/libs/mapLocations";
import { isQuestComplete } from "@/libs/objectives";
import {
  getWarRelationship,
  isWarObjectiveLeader,
  maskWarObjectives,
  withMercenaryParticipation,
} from "@/libs/objectiveWar";
import { placementCopiesInSector, placementToSectorUser } from "@/libs/overworldAi";
import { calcActiveUserRegen, calcMaxEnergy, getEffectiveLevel } from "@/libs/profile";
import { getServerPusher, updateUserOnMap } from "@/libs/pusher";
import { boostPvpGain, getPvpBoost } from "@/libs/pvpExperience";
import {
  filterQuestTrackersForDbPersist,
  getNewTrackers,
  getQuestTargetSectorsToCheck,
  getUserQuests,
  snapQuestTargetsToReachable,
} from "@/libs/quest";
import { isAvailableUserQuests } from "@/libs/quest/availability";
import { questHasOverworldObjectives } from "@/libs/quest/projection";
import { ISOLATED_PYRAMID_MESSAGE } from "@/libs/questRun";
import { hasEnergyQueue } from "@/libs/queue";
import {
  beyondSectorMapEdge,
  isOnSectorMapEdge,
  type SectorMapEdge,
} from "@/libs/sector-map/crossing";
import {
  chebyshevDistance,
  findNearestWalkableCoordinate,
  isReachableCoordinate,
  isWalkableCoordinate,
} from "@/libs/sector-map/validation";
import type { GlobalMapData } from "@/libs/sector-map/world-types";
import { snapshotSpriteAnimations } from "@/libs/spriteAnimations";
import { isUserCurrentlyStealthed } from "@/libs/stealth";
import { getTimedRegenerationGain, type TimedBuff } from "@/libs/timedBuffs";
import { regenerationBuffs } from "@/libs/titles";
import {
  calcGlobalTravelTime,
  calcIsInVillage,
  filterLiveSectorBattleUsers,
  findGlobalTravelDestination,
  findLandingNear,
} from "@/libs/travel";
import { isTutorialActive } from "@/libs/tutorial";
import { getMapDisguise } from "@/libs/war";
import { fetchActionUser } from "@/queries/actionReadiness";
import {
  fetchAllGameSettings,
  fetchUser,
  findUserById,
  incrementUserMoney,
} from "@/queries/profile";
import { fetchIsolatedPyramid } from "@/queries/quests";
import {
  fetchSectorWindowData,
  findUserDataForCreatorBody,
  findUserDataForGetSectorData,
  findUserForGlobalTravelFinish,
  findVillageForMoveInSector,
  insertActionLogForRobPlayer,
  listQuestHistoryForGetSectorData,
  listQuestHistoryForGetSectorData2,
  listSectorForGetAllSectors,
  listUserDataForCompleteExpiredGlobalTravel,
  listWarForGetSectorData,
  selectBattleForGetSectorData,
  updateClanForRobPlayer,
  updateUserDataForCompleteExpiredGlobalTravel,
  updateUserDataForMoveInSector,
  updateUserDataForRobPlayer,
  updateUserDataForRobPlayer2,
  updateUserDataForStartGlobalMove,
} from "@/queries/travel";
import { fetchSectorVillage, findVillageBySector } from "@/queries/village";
import { initiateBattle } from "@/routers/combat";
import { fetchUpdatedUser, type UserWithRelations } from "@/routers/profile";
import { breakStealth } from "@/routers/stealth";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  ratelimitMiddleware,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { isTransientDatabaseError } from "@/server/dbRetry";
import {
  actionReadinessResponse,
  prepareActionReadiness,
} from "@/server/utils/actionReadiness";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { fetchPvpExperienceAverage } from "@/server/utils/pvpExperience";
import {
  fetchPublishedSectorMap,
  fetchPublishedSectorMaps,
  getSectorNeighborIds,
  habitatSectorPool,
  publishedMapsToPrefetchForMove,
  resolveSectorCrossing,
} from "@/server/utils/sectorMap";
import { missingUserMessage } from "@/server/utils/sentry";
import { canEnterWarCamp, fetchWarCampEntry } from "@/server/utils/warMercenary";
import { findRelationship } from "@/utils/alliance";
import { groupBy } from "@/utils/grouping";
import { regenTicksSince, secondsFromNow } from "@/utils/time";
import { getStrucBoost } from "@/utils/village";
import type { QuestTrackerType } from "@/validators/objectives";
import {
  sectorIdSchema,
  sectorLatitudeSchema,
  sectorLongitudeSchema,
  startGlobalMoveSchema,
} from "@/validators/travel";
import { userDeltaResponseSchema } from "@/validators/userCache";

const pusher = getServerPusher();

export const travelRouter = createTRPCRouter({
  // Rob another player
  robPlayer: protectedProcedure
    .meta({ mcp: { description: "Rob another player for ryo" } })
    .use(ratelimitMiddleware)
    .input(
      z.object({
        // Coordinate bounds via zod (no sector-map read needed): the co-location
        // guards below require both robber and victim to stand on this exact tile,
        // and a player can only ever be on a walkable, in-bounds tile.
        longitude: sectorLongitudeSchema,
        latitude: sectorLatitudeSchema,
        sector: sectorIdSchema,
        userId: z.string(),
        originSocketId: z.string().max(128).optional(),
      }),
    )
    .output(
      userDeltaResponseSchema.extend({
        battleId: z.string().optional(),
        money: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Query
      let [user, target, sectorData, pvpAverage, settings] = await Promise.all([
        fetchActionUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
        findVillageBySector(ctx.drizzle, input.sector),
        fetchPvpExperienceAverage(ctx.drizzle),
        fetchAllGameSettings(ctx.drizzle),
      ]);

      // Guard
      if (!user.isOutlaw) return errorResponse("Only outlaws can rob other players");
      const readiness = prepareActionReadiness(user, settings);
      if (readiness.error) return errorResponse(readiness.error);
      user = readiness.user;
      if (user.isBanned) return errorResponse("You are banned");
      if (target.isBanned) return errorResponse("Target is banned");
      if (target.status !== "AWAKE")
        return errorResponse("Target cannot currently be robbed");
      if (user.clanId && target.clanId && user.clanId === target.clanId)
        return errorResponse("Cannot rob faction members");
      if (target.rank === "STUDENT" || target.rank === "GENIN") {
        return errorResponse("Cannot rob Academy Students or Genins");
      }
      // Wake Island always blocks robbing
      if (input.sector === MAP_WAKE_ISLAND_SECTOR) {
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

      // Level restrictions, skipped in the war-torn sector
      const isInWarTornSector = user.sector === MAP_WAR_TORN_BATTLEGROUND_SECTOR;
      if (!isInWarTornSector) {
        const robberLevel = getEffectiveLevel(user);
        const targetLevel = getEffectiveLevel(target);
        const levelDifference = robberLevel - targetLevel;

        if (levelDifference > ROBBING_MAX_LEVEL_DIFFERENCE) {
          return errorResponse(
            `Cannot rob ${target.username} - they are more than ${ROBBING_MAX_LEVEL_DIFFERENCE} levels below you (${levelDifference} level difference)`,
          );
        }

        if (levelDifference < -ROBBING_MAX_LEVEL_DIFFERENCE) {
          return errorResponse(
            `Cannot rob ${target.username} - they are more than ${ROBBING_MAX_LEVEL_DIFFERENCE} levels above you (${Math.abs(levelDifference)} level difference)`,
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

      const success = Math.random() < ROBBING_SUCCESS_CHANCE;

      // Break stealth before the money writes or the battle, so initiateBattle sees the
      // settled stealth state and no second stealth roll happens
      if (user.stealthActive) {
        await breakStealth(ctx.drizzle, ctx.userId, user.stealth);
      }

      if (success) {
        const stolenAmount = Math.floor(target.money * ROBBING_STOLLEN_AMOUNT);
        const prestigeGain = boostPvpGain(
          ROBBING_VILLAGE_PRESTIGE_GAIN,
          getPvpBoost(user, [pvpAverage]).totalPercent,
        );

        // Debit the victim first, re-checking at write time every target condition that a
        // concurrent request could have changed since the read: immunity, balance, status and
        // position. Nothing is credited unless this guarded statement wins.
        const now = new Date();
        const targetUpdate = await updateUserDataForRobPlayer(
          ctx.drizzle,
          stolenAmount,
          target,
          now,
          input,
        );
        if (targetUpdate.rowsAffected === 0) {
          return errorResponse("Target can no longer be robbed");
        }

        // Recovery and credit share the guarded account write; clan rewards follow only a win.
        const robberUpdate = await updateUserDataForRobPlayer2(
          ctx.drizzle,
          stolenAmount,
          prestigeGain,
          ctx,
          readiness,
        );

        if (robberUpdate.rowsAffected === 0) {
          // Return the stolen ryo since the robber could not be credited
          await incrementUserMoney(ctx.drizzle, stolenAmount, target.userId);
          return errorResponse("Failed to update robber's data");
        }

        // Independent post-credit writes retain the existing mutation phase.
        await Promise.all([
          insertActionLogForRobPlayer(ctx.drizzle, user, stolenAmount),
          ...(user.clanId
            ? [updateClanForRobPlayer(ctx.drizzle, { clanId: user.clanId })]
            : []),
        ]);

        // Notify the target after the response; the robbery is already committed
        after(() =>
          pusher.trigger(target.userId, "event", {
            type: "userMessage",
            message: `You've been robbed by ${user.username}`,
          }),
        );

        return actionReadinessResponse(
          {
            success: true,
            message: `Successfully robbed ${stolenAmount} money from ${target.username}!`,
            money: user.money + stolenAmount,
            ...getRobPlayerUserUpdate({
              user: readiness.initial,
              stolenAmount,
              prestigeGain,
            }),
          },
          readiness,
          ctx.drizzle,
        );
      } else {
        // Failed rob attempt - initiate combat
        const battle = await initiateBattle(
          {
            longitude: input.longitude,
            latitude: input.latitude,
            sector: input.sector,
            userIds: [ctx.userId],
            actionReadiness: readiness,
            actionUserId: ctx.userId,
            originSocketId: input.originSocketId,
            targetIds: [input.userId],
            client: ctx.drizzle,
            biome: "default",
          },
          "COMBAT",
        );

        if (battle.success) {
          return actionReadinessResponse(
            {
              ...battle,
              success: false,
              message: "Rob attempt failed! Prepare for combat!",
              battleId: battle.battleId,
            },
            { notice: battle.actionNotice },
          );
        } else {
          return battle;
        }
      }
    }),
  // Get users within a given sector
  getSectorData: protectedProcedure
    .meta({
      mcp: { description: "Get users and data within current sector" },
    })
    .input(z.object({ sector: sectorIdSchema }))
    .query(async ({ input, ctx }) => {
      // The client's sector usually matches; overlap its reads with the authoritative user lookup.
      const [user, sectorWindowData, fetchedWarData, liveBattles, requestedMap] =
        await Promise.all([
          findUserDataForGetSectorData(ctx.drizzle, ctx),
          fetchSectorWindowData(ctx.drizzle, ctx.userId, input.sector),
          listWarForGetSectorData(ctx.drizzle),
          // All recently-advanced battles. The Battle table only holds a handful of rows
          // (the cleaner drops them after a day), so this indexed range scan is cheaper than
          // a second sequential round-trip filtered by the sector's battle ids.
          selectBattleForGetSectorData(ctx.drizzle),
          // Roaming NPC copies anchor on this map; the published-map cache keeps it warm.
          fetchPublishedSectorMap(ctx.drizzle, input.sector).catch(() => null),
        ]);

      if (!user) {
        throw serverError("NOT_FOUND", missingUserMessage(ctx.userId));
      }

      // Guard: Only awake/travel/queued users can scout
      // QUEUED is included so users in raid queues can still see war/sector data
      if (!["AWAKE", "TRAVEL", "QUEUED"].includes(user.status)) {
        return {
          users: [],
          village: null,
          sectorData: null,
          warData: null,
          overworldAis: [],
          questPlacements: [],
        };
      }
      // Crossings can leave a stale query key. Never return another sector's data.
      const [users, villageData, sectorData, placements] =
        user.sector === input.sector
          ? sectorWindowData
          : await fetchSectorWindowData(ctx.drizzle, ctx.userId, user.sector);

      // Keep the caller's ban/activity exceptions outside the indexed sector range query.
      // Project only the public sector fields from the already-loaded caller snapshot.
      if (user.status === "AWAKE" && !user.isAi) {
        users.push({
          attributes: user.attributes,
          items: user.items,
          gender: user.gender,
          spriteBodyStyle: user.spriteBodyStyle,
          userId: user.userId,
          username: user.username,
          longitude: user.longitude,
          latitude: user.latitude,
          location: user.location,
          curHealth: user.curHealth,
          maxHealth: user.maxHealth,
          sector: user.sector,
          status: user.status,
          avatar: user.avatar,
          avatarLight: user.avatarLight,
          level: user.level,
          experience: user.experience,
          rank: user.rank,
          isOutlaw: user.isOutlaw,
          isBanned: user.isBanned,
          immunityUntil: user.immunityUntil,
          robImmunityUntil: user.robImmunityUntil,
          updatedAt: user.updatedAt,
          villageId: user.villageId,
          battleId: user.battleId,
          anbuId: user.anbuId,
          stealthActive: user.stealthActive,
          stealthActivatedAt: user.stealthActivatedAt,
          stealth: user.stealth,
          anbuSquad: user.anbuSquad,
        });
      }

      const warData = withMercenaryParticipation(fetchedWarData);
      // Only draw battle markers for fights that still exist and are being played
      const liveBattleIds = new Set(liveBattles.map((b) => b.id));

      // Filter out stealthed players (unless it's the current user)
      // Then anonymize enemy ANBU squad members
      const processedUsers = filterLiveSectorBattleUsers(users, liveBattleIds)
        .filter((u) => u.userId === ctx.userId || !isUserCurrentlyStealthed(u))
        .map((u) => {
          const disguise = getMapDisguise(user, u, warData);
          const warRelationship = getWarRelationship(warData, user, u) ?? null;
          const isMasked = disguise === "Mercenary";
          // Raw traits and inventory inputs stay server-side; masked users receive a uniform below.
          const { attributes, items, gender, spriteBodyStyle, ...publicUser } = u;
          const participant = {
            ...publicUser,
            warRelationship,
            isMasked,
            spriteAppearance: resolveSpriteAppearance({
              attributes,
              items,
              gender,
              spriteBodyStyle,
            }),
          };
          if (isMasked)
            return {
              ...participant,
              username: disguise,
              spriteAppearance: anonymousSpriteAppearance(),
              avatar: IMG_AVATAR_DEFAULT,
              avatarLight: IMG_AVATAR_DEFAULT,
            };
          if (disguise && u.anbuSquad) {
            return {
              ...participant,
              username: disguise,
              spriteAppearance: anonymousSpriteAppearance(true),
              avatar: u.anbuSquad.image,
              avatarLight: u.anbuSquad.image,
            };
          }
          return participant;
        });

      const sectorMap =
        user.sector === input.sector
          ? requestedMap
          : await fetchPublishedSectorMap(ctx.drizzle, user.sector).catch(() => null);
      const overworldAis = placements.flatMap((p) => {
        if (!p.aiTemplate?.isAi) return [];
        const template = {
          ...p.aiTemplate,
          sheets: snapshotSpriteAnimations(p.aiTemplate.spriteAnimationBindings),
        };
        // Without the map, only a placement's stored first copy can be placed safely; a biome
        // placement's stored spot is only a sample, so it shows nothing.
        if (!sectorMap)
          return p.sectorType !== "biome" && p.sector === user.sector
            ? [placementToSectorUser(p, template)]
            : [];
        return placementCopiesInSector(
          p,
          user.sector,
          sectorMap,
          habitatSectorPool(p.habitats),
        ).flatMap((copy) =>
          Array.from({ length: copy.groupSize }, (_, member) =>
            placementToSectorUser(p, template, copy, member),
          ),
        );
      });

      // Quest history can only affect placements backed by an AI template.
      const readsQuests = placements.some((p) => p.aiTemplate?.isAi);
      const hostsCreator = processedUsers.some(isCreator);
      const [userQuests, completedQuests, creatorBody] = await Promise.all([
        readsQuests ? listQuestHistoryForGetSectorData(ctx.drizzle, ctx) : [],
        readsQuests ? listQuestHistoryForGetSectorData2(ctx.drizzle, ctx) : [],
        hostsCreator ? findUserDataForCreatorBody(ctx.drizzle) : undefined,
      ]);
      const activeQuests = getUserQuests({ ...user, userQuests, completedQuests });
      const boundPlacementIds = new Set(
        activeQuests.flatMap((entry) =>
          entry.content.objectives.map((objective) => objective.overworldPlacementId),
        ),
      );
      const questPlacements = placements
        .filter(
          (p) =>
            p.aiTemplate?.isAi &&
            boundPlacementIds.has(p.id) &&
            (p.sector === user.sector ||
              (p.sectorType === "specific" && p.locationType === "specific")),
        )
        .map((p) => ({
          npcPlacementId: p.id,
          sector: p.sector,
          longitude: p.longitude,
          latitude: p.latitude,
        }));
      // Reuse landmark visibility and inheritance rules; remote coordinates carry no NPC actions.
      const visibleLocations = getQuestMapLocations(
        { ...user, userQuests: activeQuests },
        [],
        questPlacements,
      );
      const visibleTiles = new Set(
        visibleLocations.map((l) => `${l.sector}:${l.longitude}:${l.latitude}`),
      );

      const creatorSheets =
        creatorBody && snapshotSpriteAnimations(creatorBody.spriteAnimationBindings);
      return {
        // A disguise renames the creator, so a disguised creator keeps the disguise.
        users: creatorBody?.avatar
          ? processedUsers.map((u) =>
              isCreator(u)
                ? {
                    ...u,
                    bodyArt: creatorBody.avatar,
                    bodyIdle: creatorSheets?.idle,
                    bodyMove: creatorSheets?.move,
                  }
                : u,
            )
          : processedUsers,
        village: villageData,
        sectorData,
        warData: warData.map((w) =>
          maskWarObjectives(
            w,
            user.villageId,
            isWarObjectiveLeader(user, user.village),
            ctx.userId,
          ),
        ),
        overworldAis,
        questPlacements: questPlacements.filter((p) =>
          visibleTiles.has(`${p.sector}:${p.longitude}:${p.latitude}`),
        ),
      };
    }),
  // Get village & alliance information for a given sector
  getVillageInSector: protectedProcedure
    .meta({
      mcp: { description: "Get village and alliance info for sector" },
    })
    .input(z.object({ sector: sectorIdSchema, isOutlaw: z.boolean().prefault(false) }))
    .query(async ({ input, ctx }) => {
      return await fetchSectorVillage(ctx.drizzle, input.sector, input.isOutlaw);
    }),
  // Initiate travel on the globe
  startGlobalMove: protectedProcedure
    .meta({
      mcp: { description: "Start global travel to another sector" },
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
        return errorResponse("Target sector does not exist");
      }
      // Fetch the user, destination and camp admission in parallel. Global travel can begin
      // from any local tile; the target map only determines a safe landing.
      let [user, targetSectorMap, warCampEntry, settings] = await Promise.all([
        fetchActionUser(ctx.drizzle, ctx.userId),
        fetchPublishedSectorMap(ctx.drizzle, input.sector).catch(() => null),
        fetchWarCampEntry(ctx.drizzle, ctx.userId, input.sector),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      if (!targetSectorMap) {
        return errorResponse("The destination sector has no published map yet");
      }
      if (hasEnergyQueue(user)) {
        const settled = await settleEnergyQueueUser(ctx.drizzle, ctx.userId);
        if (!settled) return errorResponse("User not found");
        user = settled;
      }
      if (user.sector === input.sector) {
        return errorResponse("You are already in that sector");
      }
      const readiness = prepareActionReadiness(user, settings);
      if (readiness.error) return errorResponse(readiness.error);
      user = readiness.user;
      if (!canEnterWarCamp(warCampEntry, user, input.sector))
        return errorResponse(
          "This sector is reserved for participants in an active war camp.",
        );
      const departureSector = user.sector;
      const travelTime = calcGlobalTravelTime(
        departureSector,
        input.sector,
        map as unknown as GlobalMapData,
      );
      const endTime = secondsFromNow(travelTime);
      // Players being onboarded (in the tutorial, or students on the road to Genin)
      // land beside their active onboarding objective; other arrivals use the map
      // center. Only the onboarding quests count: their objectives are never hidden,
      // whereas landing beside another quest's goal could reveal a hidden location.
      const tutorialTarget =
        isTutorialActive(user) || user.rank === "STUDENT"
          ? user.questData
              ?.filter((quest) => ONBOARDING_QUEST_IDS.has(quest.id))
              .flatMap((quest) => quest.goals)
              .find(
                (goal) =>
                  !goal.done &&
                  goal.sector === input.sector &&
                  goal.longitude !== undefined &&
                  goal.latitude !== undefined,
              )
          : undefined;
      const destination =
        (tutorialTarget?.longitude !== undefined &&
        tutorialTarget?.latitude !== undefined
          ? findLandingNear(
              targetSectorMap,
              { x: tutorialTarget.longitude, y: tutorialTarget.latitude },
              randomInt,
            )
          : null) ?? findGlobalTravelDestination(targetSectorMap);
      if (!destination) {
        return errorResponse("The destination sector has no walkable tiles");
      }
      const result = await updateUserDataForStartGlobalMove(
        ctx.drizzle,
        input,
        destination,
        endTime,
        ctx,
        departureSector,
        user,
        readiness,
      );
      if (result.rowsAffected === 1) {
        user.sector = input.sector;
        user.longitude = destination.x;
        user.latitude = destination.y;
        user.status = "TRAVEL";
        user.travelFinishAt = endTime;
        // Only broadcast if user is NOT stealthed. The sector being left is told
        // too, so the departing player stops being drawn there instead of lingering
        // until the next poll.
        if (!isUserCurrentlyStealthed(user)) {
          after(() => updateUserOnMap(pusher, input.sector, user));
          if (departureSector !== input.sector) {
            after(() => updateUserOnMap(pusher, departureSector, user));
          }
        }
        return actionReadinessResponse(
          {
            success: true,
            message: "OK",
            data: {
              sector: input.sector,
              longitude: destination.x,
              latitude: destination.y,
              travelFinishAt: endTime,
              status: "TRAVEL" as const,
            },
          },
          readiness,
          ctx.drizzle,
        );
      } else {
        const latest = await fetchUser(ctx.drizzle, ctx.userId);
        if (latest.status !== "AWAKE") {
          return errorResponse(`Status is: ${latest.status.toLowerCase()}`);
        } else if (latest.sector !== departureSector) {
          return errorResponse("Your location changed; please try again");
        } else {
          return errorResponse("Failed to start travel");
        }
      }
    }),
  // Finish travel on the globe
  finishGlobalMove: protectedProcedure
    .meta({ mcp: { description: "Complete global travel" } })
    .output(
      userDeltaResponseSchema.extend({
        projectedQuestIds: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx }) => {
      const loaded = await findUserForGlobalTravelFinish(ctx.drizzle, ctx.userId);
      if (!loaded) return errorResponse("User not found");
      let user = loaded as NonNullable<UserWithRelations>;
      let canProject = true;
      if (hasEnergyQueue(user)) {
        const settled = await settleEnergyQueueUser(ctx.drizzle, ctx.userId);
        if (!settled) return errorResponse("User not found");
        user = {
          ...settled,
          regeneration: settled.regenerationWithoutTimedBuffs ?? settled.regeneration,
        };
        // Hydration can settle profile fields beyond the arrival projection.
        canProject = false;
      }
      if (!["TRAVEL", "AWAKE"].includes(user.status))
        return errorResponse(
          `Cannot finish travel because your status is: ${user.status.toLowerCase()}`,
        );
      const wasTravelling = user.status === "TRAVEL";
      if (wasTravelling && user.travelFinishAt && user.travelFinishAt > new Date())
        return errorResponse("You have not arrived yet");
      // The cleaner can finish travel before profile hydration evaluates arrival goals.
      canProject &&= wasTravelling;
      const projectedQuests = user.userQuests.filter(
        (entry) =>
          entry.questType !== "achievement" ||
          (entry.quest && questHasOverworldObjectives(entry.quest)),
      );
      const projectedQuestIds = projectedQuests.map((entry) => entry.questId);
      const knownIds = new Set(projectedQuestIds);
      const visible = projectedQuests.filter(
        (entry) =>
          entry.quest &&
          (((entry.questType === "battlepyramid" || entry.isolated) &&
            !entry.endAt &&
            !entry.completed) ||
            isAvailableUserQuests({ ...entry.quest, ...entry }, user, true).check),
      );
      const arrival = {
        ...user,
        status: "AWAKE" as const,
        userQuests: visible,
        questData: (user.questData ?? []).filter((tracker) => knownIds.has(tracker.id)),
      };
      // Team synchronization, war targets and delivery inventory belong to the
      // authoritative progression flow, beyond this arrival-only snapshot.
      const canEvaluate =
        !user.questPartyId &&
        !visible.some(
          (entry) =>
            entry.questType === "war" ||
            entry.quest.content.objectives.some(
              (objective) =>
                objective.task === "deliver_item" ||
                ("sectorType" in objective && objective.sectorType === "enemy_village"),
            ),
        );
      canProject &&= canEvaluate;
      const previouslyDoneGoals = new Set(
        arrival.questData.flatMap((tracker) =>
          tracker.goals
            .filter((goal) => goal.done)
            .map((goal) => `${tracker.id}:${goal.id}`),
        ),
      );
      const progress =
        wasTravelling && canEvaluate
          ? getNewTrackers(
              arrival,
              [{ task: "any" }],
              undefined,
              undefined,
              undefined,
              // Pending personal receipts need the authoritative consequence handler.
              true,
            )
          : { trackers: arrival.questData, consequences: [], notifications: [] };
      canProject &&= progress.consequences.every(
        (entry) => entry.type === "update_user",
      );
      // Passive completion needs profile reconciliation for rewards and team navigation.
      canProject &&= !progress.trackers.some(
        (tracker) =>
          visible.some(
            (entry) =>
              entry.questId === tracker.id &&
              (["tier", "daily", "achievement"].includes(entry.questType) ||
                (entry.quest.teamEnabled && isQuestComplete(entry.quest, tracker))),
          ) &&
          tracker.goals.some(
            (goal) => goal.done && !previouslyDoneGoals.has(`${tracker.id}:${goal.id}`),
          ),
      );
      if (canProject && wasTravelling) {
        const sectors = getQuestTargetSectorsToCheck(arrival, progress.trackers, true);
        if (sectors.length > 0) {
          // The target sectors depend on instantiated trackers. A missing map leaves
          // its target usable and unchecked, matching ordinary profile hydration.
          const maps = await fetchPublishedSectorMaps(ctx.drizzle, sectors).catch(
            () => null,
          );
          if (maps) snapQuestTargetsToReachable(arrival, progress.trackers, maps);
        }
      }
      const persisted = canProject
        ? [
            ...(user.questData ?? []).filter((tracker) => !knownIds.has(tracker.id)),
            ...filterQuestTrackersForDbPersist(progress.trackers, arrival),
          ]
        : undefined;
      const claim = await completeGlobalTravel(ctx.drizzle, user, persisted);
      if (wasTravelling && !claim.success)
        return errorResponse("Your travel state changed. Please try again");
      user.status = "AWAKE";
      user.travelFinishAt = null;
      if (!isUserCurrentlyStealthed(user))
        after(() => updateUserOnMap(pusher, user.sector, user));
      return {
        success: true,
        message:
          canProject && progress.notifications.length
            ? progress.notifications.join("\n")
            : "OK",
        ...(canProject
          ? {
              projectedQuestIds,
              ...getFinishGlobalMoveUserUpdate({
                claimSuccess: claim.success,
                claimClaimedAt: claim.claimedAt,
                arrival,
                trackers: progress.trackers,
              }),
            }
          : {}),
      };
    }),
  // Get all sector ownership
  getAllSectors: protectedProcedure
    .meta({ mcp: { description: "Get all sector ownership info" } })
    .query(async ({ ctx }) => {
      const allSectors = await listSectorForGetAllSectors(ctx.drizzle);
      return [...groupBy(allSectors, "villageId")].map(([villageId, sectors]) => ({
        villageId,
        sectors: sectors.map((s) => s.sector),
      }));
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
    .meta({ mcp: { description: "Move user within current sector" } })
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
        avatar: z.preprocess((val) => val || IMG_AVATAR_DEFAULT, z.url()),
        avatarLight: z.preprocess((val) => val || IMG_AVATAR_DEFAULT, z.url()),
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
              avatar: z.string(),
              avatarLight: z.string(),
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
      // When the destination looks like a default-sized border crossing, load
      // that neighbour in the same query so the walk does not wait on a
      // second sequential published-map read. A failed read answers like a
      // missing map: a thrown error would leave the client's walk re-issuing
      // the move while its target is still set.
      const sectorsToPrefetch = publishedMapsToPrefetchForMove(sector, {
        x: longitude,
        y: latitude,
      });
      // Larger maps can keep a predicted crossing local. Failed admission
      // prefetches are retried below only when the move actually crosses.
      const prefetchedCampSector = sectorsToPrefetch[1];
      const [maps, originalUser, warCampEntry, isolated, settings] = await Promise.all([
        fetchPublishedSectorMaps(ctx.drizzle, sectorsToPrefetch).catch(() => null),
        fetchActionUser(ctx.drizzle, userId),
        prefetchedCampSector === undefined
          ? undefined
          : fetchWarCampEntry(ctx.drizzle, userId, prefetchedCampSector).catch(
              () => undefined,
            ),
        fetchIsolatedPyramid(ctx.drizzle, userId),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      if (isolated) return errorResponse(ISOLATED_PYRAMID_MESSAGE);
      if (!originalUser) return errorResponse("User not found");
      if (!maps) return errorResponse("Connection hiccup, please try moving again");
      let readiness = prepareActionReadiness(originalUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      let moveUser = readiness.user;
      const sectorMap = maps.get(sector);
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
        // Training eligibility is sector-based; ordinary steps can defer settlement.
        const needsSettlement = hasEnergyQueue(originalUser);
        const [settled, campEntry, neighbourMap] = await Promise.all([
          needsSettlement ? settleEnergyQueueUser(ctx.drizzle, userId) : undefined,
          // Authored dimensions can change the predicted crossing direction.
          targetSector === prefetchedCampSector && warCampEntry
            ? warCampEntry
            : fetchWarCampEntry(ctx.drizzle, userId, targetSector),
          maps.get(targetSector) ??
            fetchPublishedSectorMap(ctx.drizzle, targetSector).catch(() => null),
        ]);
        if (needsSettlement) {
          if (!settled) return errorResponse("User not found");
          readiness = prepareActionReadiness(
            {
              ...originalUser,
              ...settled,
              anbuSquad: originalUser.anbuSquad,
            },
            settings,
          );
          if (readiness.error) return errorResponse(readiness.error);
          moveUser = readiness.user;
        }
        // Settlement can change village membership, so use the settled user for admission.
        if (!canEnterWarCamp(campEntry, moveUser, targetSector))
          return errorResponse(
            "This sector is reserved for participants in an active war camp.",
          );
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
          ? 1 + chebyshevDistance(entryTile, destination)
          : chebyshevDistance({ x: curLongitude, y: curLatitude }, destination);
      // Optimistic update & query simultaneously
      const moveOutcome = await Promise.all([
        updateUserDataForMoveInSector(
          ctx.drizzle,
          targetSector,
          originalUser,
          destination,
          location,
          userId,
          sector,
          moveUser,
          input,
          villageId,
          readiness,
        ),
        isVillage ? findVillageForMoveInSector(ctx.drizzle, targetSector) : undefined,
      ]).catch((error: unknown) => {
        // The CAS guard makes a blind retry unsafe: a re-issue after the first
        // attempt already applied would match zero rows. Degrade to an ordinary
        // failed response, which the client already clears its target on.
        if (isTransientDatabaseError(error)) return null;
        throw error;
      });
      if (!moveOutcome) {
        return errorResponse("Connection hiccup, please try moving again");
      }
      const [result, sectorVillage] = moveOutcome;
      const user = moveUser;
      // Check if move was successful
      if (result.rowsAffected === 1) {
        // Check for encounters / village defence
        if (isVillage && sectorVillage && sectorVillage.id !== villageId) {
          const relations = [
            ...sectorVillage.relationshipA,
            ...sectorVillage.relationshipB,
          ];
          const relation = findRelationship(relations, villageId, sectorVillage.id);
          if (relation?.status === "ENEMY") {
            // Chance of getting attacked by village protector
            const chance = getStrucBoost("patrolsPerLvl", sectorVillage.structures);
            if (Math.random() < (travelLength * chance) / 100) {
              // Chance of ANBU squad avoiding attack
              const anbuChance = user.anbuId
                ? anbuStealthChance(user.anbuSquad?.stealthLevel ?? 0)
                : 0;
              if (Math.random() < anbuChance / 100) {
                return actionReadinessResponse(
                  {
                    success: true,
                    message: "ANBU stealth prevented guard attack",
                  },
                  readiness,
                  ctx.drizzle,
                );
              }
              // Attack village protector
              const battle = await initiateBattle(
                {
                  longitude: destination.x,
                  latitude: destination.y,
                  sector: targetSector,
                  userIds: [ctx.userId],
                  targetIds: [VILLAGE_PROTECTOR_AI_ID],
                  client: ctx.drizzle,
                  scaleTarget: true,
                  biome: "default",
                  autoCombatUserIds: user.defaultAutoCombat ? [ctx.userId] : undefined,
                },
                "VILLAGE_PROTECTOR",
              );
              if (battle.success) {
                return actionReadinessResponse(
                  {
                    ...battle,
                    success: true,
                    message: "Attacked by village protector",
                  },
                  readiness,
                  ctx.drizzle,
                  { status: "BATTLE", battleId: battle.battleId },
                );
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
        if (!isUserCurrentlyStealthed(user)) {
          const broadcast = {
            ...output,
            experience: user.experience,
            rank: user.rank,
          };
          after(() => updateUserOnMap(pusher, targetSector, broadcast));
          if (targetSector !== sector) {
            after(() => updateUserOnMap(pusher, sector, broadcast));
          }
        }
        return actionReadinessResponse(
          { success: true, message: "OK", data: output },
          readiness,
          ctx.drizzle,
        );
      } else {
        // The read above raced the update, so it can predate whatever made the guard
        // miss and would then explain the failure wrongly - or not at all, leaving the
        // throw below. Re-read for the failure path; the success path keeps the snapshot.
        const latest = await findUserById(ctx.drizzle, userId);
        if (!latest) {
          return errorResponse("Your character no longer exists. Please refresh.");
        }
        // Force an update on the map of the real information (only if not stealthed)
        if (!isUserCurrentlyStealthed(latest)) {
          after(() => updateUserOnMap(pusher, latest.sector, latest));
        }
        // Figure out return message
        if (latest.status !== "AWAKE") {
          return errorResponse(`Status is: ${latest.status.toLowerCase()}`);
        }
        if (latest.sector !== sector) {
          return errorResponse("You are not in the correct sector");
        }
        if (latest.longitude !== curLongitude || latest.latitude !== curLatitude) {
          return errorResponse("You have moved since you started this move");
        }
        if (latest.villageId !== villageId) {
          return errorResponse(
            "Seems like your village alliance has changed, please check profile.",
          );
        }
        if (latest.updatedAt.getTime() !== moveUser.updatedAt.getTime())
          return errorResponse("Your state changed. Please try moving again");
        throw serverError(
          "BAD_REQUEST",
          `Unknown error while moving. Route input: ${JSON.stringify(input)}. User information: ${JSON.stringify(
            {
              sector: latest.sector,
              longitude: latest.longitude,
              latitude: latest.latitude,
              status: latest.status,
              villageId: latest.villageId,
            },
          )}`,
        );
      }
    }),
});

/** Quests whose objectives guide where onboarding players land after global travel. */
const ONBOARDING_QUEST_IDS = new Set([
  TUTORIAL_STARTER_QUEST_ID,
  TUTORIAL_GENIN_EXAM_QUEST_ID,
]);

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
  | { valid: true; direction: SectorMapEdge }
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
  const direction = outNorth ? "north" : outSouth ? "south" : outWest ? "west" : "east";
  const beyond = beyondSectorMapEdge(map, direction, current);
  if (
    !isOnSectorMapEdge(map, direction, current) ||
    target.x !== beyond.x ||
    target.y !== beyond.y
  ) {
    return { valid: false, error: "You must be at the matching edge to cross over" };
  }
  return { valid: true, direction };
};

/** Complete due travel and consume its recovery ticks without training queued stats. */
const completeGlobalTravel = async (
  client: DrizzleClient,
  user: UserData & { raidBuffs?: TimedBuff[] },
  questData?: QuestTrackerType[],
) => {
  const recoveryTicks = regenTicksSince(user.regenAt);
  const recovery = getTimedRegenerationGain(
    user.regeneration,
    regenerationBuffs(user),
    user.regenAt,
    recoveryTicks,
    REGEN_SECONDS,
  );
  return retryOnDeadlock(() =>
    claimUserSnapshot({
      client,
      userId: user.userId,
      updatedAt: user.updatedAt,
      where: [
        eq(userData.status, "TRAVEL"),
        or(isNull(userData.travelFinishAt), lte(userData.travelFinishAt, new Date())),
      ],
      set: {
        status: "AWAKE",
        travelFinishAt: null,
        ...(questData ? { questData } : {}),
        ...(hasEnergyQueue(user)
          ? {
              // Travel recovers Energy, but its elapsed ticks cannot train village-only queues.
              curEnergy: sql`LEAST(${user.maxEnergy}, ${userData.curEnergy} + ${recovery})`,
              curHealth: sql`LEAST(${user.maxHealth}, ${userData.curHealth} + ${recovery})`,
              curChakra: sql`LEAST(${user.maxChakra}, ${userData.curChakra} + ${recovery})`,
              curStamina: sql`LEAST(${user.maxStamina}, ${userData.curStamina} + ${recovery})`,
              regenAt: sql`TIMESTAMPADD(SECOND, ${recoveryTicks} * ${REGEN_SECONDS}, ${userData.regenAt})`,
            }
          : {}),
      },
    }),
  );
};

/** The hourly cleaner shares the endpoint's recovery and snapshot guards. */
export const completeExpiredGlobalTravel = async (client: DrizzleClient) => {
  const expiredTravel = and(
    eq(userData.status, "TRAVEL"),
    isNotNull(userData.travelFinishAt),
    lt(userData.travelFinishAt, new Date()),
  );
  // Mirrors `hasEnergyQueue`.
  const hasQueue = gt(userData.energyQueueTail, userData.energyQueueHead);
  const [users, settings] = await Promise.all([
    listUserDataForCompleteExpiredGlobalTravel(client, expiredTravel, hasQueue),
    fetchAllGameSettings(client),
  ]);
  await Promise.all([
    ...users.map((user) =>
      completeGlobalTravel(client, {
        ...user,
        regeneration: calcActiveUserRegen(user, settings, false),
        maxEnergy: calcMaxEnergy(user),
      }),
    ),
    // Users without an energy queue recover lazily on their next regeneration read.
    retryOnDeadlock(() =>
      updateUserDataForCompleteExpiredGlobalTravel(client, expiredTravel, hasQueue),
    ),
  ]);
};

/** Training eligibility is sector-based, so queued Energy work settles before a move. */
const settleEnergyQueueUser = async (client: DrizzleClient, userId: string) =>
  (await fetchUpdatedUser({ client, userId, forceRegen: true })).user;

type RouterOutput = inferRouterOutputs<typeof travelRouter>;
export type SectorVillage = RouterOutput["getSectorData"]["village"];
