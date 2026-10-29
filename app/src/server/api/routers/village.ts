import { z } from "zod";
import type { AllianceState, AllianceVillageType } from "@/drizzle/constants";
import {
  ALLIANCE_VILLAGE_TYPES,
  COST_SWAP_VILLAGE,
  UserRequestTypes,
  VILLAGE_LEAVE_REQUIRED_RANK,
} from "@/drizzle/constants";
import type { VillageAlliance } from "@/drizzle/schema";
import { hasRequiredRank } from "@/libs/train";
import { fetchUser } from "@/queries/profile";
import { deleteRequests } from "@/queries/sensei";
import { fetchRequests, insertRequest } from "@/queries/sparring";
import {
  countVillageSectors,
  executeReleasedForReleaseSector,
  fetchAlliances,
  fetchSector,
  fetchSectorVillage,
  fetchStructures,
  fetchVillage,
  fetchVillages,
  insertActionLogForRestoreStructurePoints,
  insertNotificationForDeclareEnemy,
  insertSectorReleaseLog,
  insertVillageAllianceForUpsertAllianceStatus,
  listKageDefendedChallengesForGet,
  listSectorForGetSectorOwnerships,
  listVillageForGetAllNames,
  listVillageForGetSectorOwnerships,
  listWarForGetSectorOwnerships,
  updateUserDataForBuyFood,
  updateUserDataForDeclareEnemy,
  updateUserDataForDeclareEnemy2,
  updateUserDataForJoinVillage,
  updateUserDataForJoinVillage2,
  updateUserDataForLeaveVillage,
  updateUserDataForSwapVillage,
  updateVillageAllianceForUpsertAllianceStatus,
  updateVillageForDeclareEnemy,
  updateVillageStructureForRestoreStructurePoints,
} from "@/queries/village";
import { createConvo } from "@/routers/comments";
import { fetchUpdatedUser, getUserProgressionUpdate } from "@/routers/profile";
import { updateRequestState } from "@/routers/sparring";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { scheduleDiscordSync } from "@/server/utils/discord/sync";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { getVillageChangeUserUpdate } from "@/server/utils/socialUserCache";
import { canAlly, canEnemy, canSurrender, findRelationship } from "@/utils/alliance";
import { isKage } from "@/utils/kage";
import { canAdministrateWars, canSwapVillage } from "@/utils/permissions";
import { calcRamenCost, getRamenHealPercentage, ramenOptions } from "@/utils/ramen";
import { canAccessStructure, getStrucBoost } from "@/utils/village";
import { idSchema } from "@/validators/misc";
import { userDeltaResponseSchema } from "@/validators/userCache";

const availRequests = ["SURRENDER", "ALLIANCE"];

export const villageRouter = createTRPCRouter({
  // Get all village names
  getAllNames: publicProcedure
    .meta({ mcp: { description: "Get all village names and IDs" } })
    .query(async ({ ctx }) => {
      return await listVillageForGetAllNames(ctx.drizzle);
    }),
  // Get all villages
  getAll: publicProcedure
    .meta({ mcp: { description: "Get all villages with kage info" } })
    .query(async ({ ctx }) => {
      return await fetchVillages(ctx.drizzle);
    }),
  // Restore village structure points
  restoreStructurePoints: protectedProcedure
    .input(z.object({ structureId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!canAdministrateWars(user.role)) {
        return errorResponse("You are not authorized to restore structure points");
      }
      // Restore
      await Promise.all([
        updateVillageStructureForRestoreStructurePoints(ctx.drizzle, input),
        insertActionLogForRestoreStructurePoints(ctx.drizzle, ctx, input),
      ]);
      return { success: true, message: "Structure points restored successfully" };
    }),
  // Get a specific village & its structures∂
  get: publicProcedure
    .meta({ mcp: { description: "Get village details and structures" } })
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      // Fetch in parallel
      const [villageData, sectorCount, defendedChallenges] = await Promise.all([
        fetchVillage(ctx.drizzle, input.id),
        countVillageSectors(ctx.drizzle, input.id),
        listKageDefendedChallengesForGet(ctx.drizzle, input),
      ]);

      // Guards
      if (!villageData) throw serverError("NOT_FOUND", "Village not found");

      // Return
      return { villageData, sectorCount, defendedChallenges };
    }),
  // Get sector ownership
  getSectorOwnerships: protectedProcedure
    .meta({ mcp: { description: "Get sector ownership and war data" } })
    .input(z.object({ onlyOwnWar: z.boolean() }))
    .query(async ({ ctx, input }) => {
      const [user, sectors, colors, sectorWars] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        listSectorForGetSectorOwnerships(ctx.drizzle),
        listVillageForGetSectorOwnerships(ctx.drizzle),
        listWarForGetSectorOwnerships(ctx.drizzle),
      ]);
      const returnedWars = input.onlyOwnWar
        ? sectorWars.filter(
            (war) =>
              war.attackerVillageId === user.villageId ||
              war.defenderVillageId === user.villageId ||
              war.warAllies.some((ally) => ally.villageId === user.villageId),
          )
        : sectorWars;
      return { sectors, colors, wars: returnedWars };
    }),
  // Buying food in ramen shop
  buyFood: protectedProcedure
    .meta({ mcp: { description: "Buy food at ramen shop to heal" } })
    .input(z.object({ ramen: z.enum(ramenOptions), villageId: z.string().nullish() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Get structures of current (visiting) village or Sydicate if outlaw
      const updatedUser = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        forceRegen: true,
      });
      const user = updatedUser.user;
      if (!user) return errorResponse("User does not exist");
      const sectorVillage = await fetchSectorVillage(
        ctx.drizzle,
        user.sector,
        user.isOutlaw,
      );
      const structures =
        sectorVillage?.structures ?? (await fetchStructures(ctx.drizzle));
      // Calculate cost
      const discount = getStrucBoost("ramenDiscountPerLvl", structures);
      const factor = (100 - discount) / 100;
      const healPercentage = getRamenHealPercentage(input.ramen);
      const cost = calcRamenCost(input.ramen, user) * factor;
      // Guard
      if (user.status !== "AWAKE") return errorResponse("You must be awake");
      if (user.money < cost) return errorResponse("You don't have enough money");
      if (user.isBanned) return errorResponse("You are banned");
      if (
        user.isOutlaw &&
        sectorVillage &&
        !canAccessStructure(user, "/ramenshop", sectorVillage)
      ) {
        return errorResponse("This is not a safe area for you to eat ramen");
      }
      // Mutate with guard
      const newStamina = Math.round(
        Math.min(
          user.maxStamina,
          user.curStamina + (user.maxStamina * healPercentage) / 100,
        ),
      );
      const newChakra = Math.round(
        Math.min(
          user.maxChakra,
          user.curChakra + (user.maxChakra * healPercentage) / 100,
        ),
      );
      const result = await updateUserDataForBuyFood(
        ctx.drizzle,
        cost,
        newStamina,
        newChakra,
        ctx,
      );
      if (result.rowsAffected === 0) {
        return errorResponse("Error trying to buy food. Try again.");
      } else {
        return {
          success: true,
          message: `You have bought food and healed to ${newStamina}SP and ${newChakra}CP`,
          ...(!updatedUser.requiresProgressionRefresh
            ? {
                ...getUserProgressionUpdate(
                  { ...user, curStamina: newStamina, curChakra: newChakra },
                  updatedUser.publishedAchievementIds,
                ),
                // MySQL rounds the remaining nonnegative integer balance, including half ryo.
                userDelta: { money: Math.round(user.money - cost) - user.money },
              }
            : {}),
        };
      }
    }),
  leaveVillage: protectedProcedure
    .meta({
      mcp: { description: "Leave current village to become outlaw" },
    })
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      // Queries
      const { user, requiresUserRefresh } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      const village = user?.village;

      // Guards
      if (!user) return errorResponse("User does not exist");
      if (user.isOutlaw) return errorResponse("You are already an outlaw");
      if (!village) return errorResponse("Village does not exist");
      if (isKage(user)) return errorResponse("You are the kage");
      if (user.villageId !== village.id) return errorResponse("Not in village");
      if (user.anbuId) return errorResponse("Leave ANBU squad first");
      if (user.clanId) return errorResponse("Leave Clan first");
      if (user.status !== "AWAKE") return errorResponse("You must be awake");
      if (user.isBanned) return errorResponse("Cannot leave while banned");
      if (!hasRequiredRank(user.rank, VILLAGE_LEAVE_REQUIRED_RANK)) {
        return errorResponse("Must be at least chunin to leave village");
      }

      // Update
      const saved = await updateUserDataForLeaveVillage(ctx.drizzle, user, ctx);
      if (!saved.rowsAffected)
        return errorResponse("Your status changed. Try again while awake.");

      scheduleDiscordSync(ctx.drizzle, ctx.userId);
      return {
        success: true,
        message: "You have left the village",
        ...(!requiresUserRefresh
          ? await getVillageChangeUserUpdate(ctx.drizzle, ctx.userId)
          : {}),
      };
    }),
  joinVillage: protectedProcedure
    .meta({ mcp: { description: "Join a village as an outlaw" } })
    .input(z.object({ villageId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Queries
      const [updatedUser, village] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchVillage(ctx.drizzle, input.villageId),
      ]);
      const user = updatedUser.user;
      // Guards
      if (!user) return errorResponse("User does not exist");
      if (!village) return errorResponse("Village does not exist");
      if (!user.isOutlaw) return errorResponse("You are not an outlaw");
      if (!village.joinable) return errorResponse("Not joinable");
      if (user.villageId === village.id) return errorResponse("Already joined");
      if (user.clanId) return errorResponse("Leave faction first");
      if (user.status !== "AWAKE") return errorResponse("You must be awake");
      if (user.isBanned) return errorResponse("Cannot leave while banned");
      if (village.type !== "VILLAGE") return errorResponse("Can only join villages");
      if (!hasRequiredRank(user.rank, VILLAGE_LEAVE_REQUIRED_RANK)) {
        return errorResponse(
          `Must be at least ${VILLAGE_LEAVE_REQUIRED_RANK.toLowerCase()} to join village`,
        );
      }

      // Update
      const [saved] = await Promise.all([
        updateUserDataForJoinVillage(ctx.drizzle, village, user, ctx),
        // Clear current sensei requests for this user
        deleteRequests(ctx.drizzle, ctx.userId),
        // Remove the user as sensei for any active students
        updateUserDataForJoinVillage2(ctx.drizzle, ctx),
      ]);
      if (!saved.rowsAffected)
        return errorResponse("Your status changed. Try again while awake.");
      scheduleDiscordSync(ctx.drizzle, ctx.userId);
      return {
        success: true,
        message: "You have joined the village",
        ...(!updatedUser.requiresUserRefresh
          ? await getVillageChangeUserUpdate(ctx.drizzle, ctx.userId)
          : {}),
      };
    }),
  swapVillage: protectedProcedure
    .input(z.object({ villageId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Queries
      const { user, requiresUserRefresh } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      if (!user) return errorResponse("User does not exist");
      const village = await fetchVillage(ctx.drizzle, input.villageId);

      // Derived
      const cost = COST_SWAP_VILLAGE;

      // Guards
      if (!village) return errorResponse("Village does not exist");
      if (isKage(user)) return errorResponse("You are the kage or leader");
      if (user.villageId === village.id) return errorResponse("Already in village");
      if (user.anbuId) return errorResponse("Leave ANBU squad first");
      if (user.clanId) return errorResponse("Leave Clan or Faction first");
      if (user.status !== "AWAKE") return errorResponse("You must be awake");
      if (user.isBanned) return errorResponse("Cannot leave while banned");
      if (!canSwapVillage(user.role)) return errorResponse("No permission to do this");
      if (cost > user.reputationPoints) return errorResponse("Need reputation points");
      if (
        village.type === "OUTLAW" &&
        !hasRequiredRank(user.rank, VILLAGE_LEAVE_REQUIRED_RANK)
      ) {
        return errorResponse("Must be at least chunin to join outlaw faction");
      }

      // Update
      const [saved] = await Promise.all([
        updateUserDataForSwapVillage(ctx.drizzle, village, user, cost, ctx),
        // Clear current sensei requests for this user
        deleteRequests(ctx.drizzle, ctx.userId),
        // Remove the user as sensei for any active students
        updateUserDataForJoinVillage2(ctx.drizzle, ctx),
      ]);

      if (!saved.rowsAffected)
        return errorResponse("Your status changed. Try again while awake.");
      scheduleDiscordSync(ctx.drizzle, ctx.userId);
      return {
        success: true,
        message: "You have swapped villages",
        userDelta: requiresUserRefresh ? undefined : { reputationPoints: -cost },
        ...(!requiresUserRefresh
          ? await getVillageChangeUserUpdate(ctx.drizzle, ctx.userId)
          : {}),
      };
    }),
  getAlliances: publicProcedure
    .meta({
      mcp: { description: "Get all village alliances and requests" },
    })
    .query(async ({ ctx }) => {
      const [villages, relationships, requests] = await Promise.all([
        fetchVillages(ctx.drizzle),
        fetchAlliances(ctx.drizzle),
        fetchRequests(ctx.drizzle, ["ALLIANCE", "SURRENDER"], 3600 * 48),
      ]);
      return { villages, relationships, requests };
    }),
  getVillageStructures: publicProcedure
    .meta({ mcp: { description: "Get structures for a village" } })
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await fetchStructures(ctx.drizzle, input.villageId);
    }),
  createRequest: protectedProcedure
    .meta({
      mcp: { description: "Create alliance or surrender request" },
    })
    .input(z.object({ targetId: z.string(), type: z.enum(UserRequestTypes) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetches
      const { user, villages, relationships, requests } = await fetchAllienceInfo(
        ctx.drizzle,
        ctx.userId,
      );

      // Derived
      const villageId = user?.villageId;
      const targetId = input.targetId;
      const target = villages.find((v) => v.id === targetId);

      // General guards
      if (!target) return errorResponse("Target village not found");
      if (!target.kageId) return errorResponse("Target village does not have kage");
      if (!user || !villageId) return errorResponse("Not in this village");
      if (!isKage(user)) return errorResponse("You are not kage");
      if (!ALLIANCE_VILLAGE_TYPES.includes(target.type as AllianceVillageType))
        return errorResponse("Invalid target type for alliance");
      if (
        !user.village?.type ||
        !ALLIANCE_VILLAGE_TYPES.includes(user.village.type as AllianceVillageType)
      )
        return errorResponse("Your village/faction cannot form alliances");
      if (!user.village.allianceSystem) return errorResponse("User Alliance disabled");
      if (!target.allianceSystem) return errorResponse("Target Alliance disabled");

      // Guards
      const request = requests
        .filter((r) => r.status === "PENDING" && r.type === input.type)
        .find(
          (r) =>
            (r.senderId === user.userId && r.receiverId === target.kageId) ||
            (r.senderId === target.kageId && r.receiverId === user.userId),
        );
      if (request) return errorResponse("Already have a pending request");
      if (!availRequests.includes(input.type)) return errorResponse("Bad r-type");

      // Check if alliance is possible
      if (input.type === "ALLIANCE") {
        const check = canAlly(relationships, villages, villageId, targetId);
        if (!check.success) return check;
      } else if (input.type === "SURRENDER") {
        const check = canSurrender(relationships, villageId, targetId);
        if (!check.success) return check;
      }

      // Content for private message
      const title =
        input.type === "ALLIANCE" ? "Alliance request" : "Surrender request";
      const content =
        input.type === "ALLIANCE"
          ? "I would like to form an alliance with your village. Please accept my request in the town hall."
          : "I would like to surrender from the war. Please accept my request in the town hall. ";

      // Mutate
      await Promise.all([
        insertRequest(ctx.drizzle, user.userId, target.kageId, input.type),
        createConvo({
          client: ctx.drizzle,
          authorUserId: ctx.userId,
          senderUserId: ctx.userId,
          receiverUserIds: [target.kageId],
          title,
          content,
        }),
      ]);

      return { success: true, message: "Alliance request sent" };
    }),
  acceptRequest: protectedProcedure
    .meta({
      mcp: { description: "Accept alliance or surrender request" },
    })
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetches
      const { user, villages, relationships, requests } = await fetchAllienceInfo(
        ctx.drizzle,
        ctx.userId,
      );

      // Derived
      const request = requests.find((r) => r.id === input.id);
      if (!request) return errorResponse("Request not found");
      const senderVillage = villages.find((v) => v.kageId === request?.senderId);
      if (!senderVillage) return errorResponse("Request author no longer kage");
      const senderId = senderVillage?.id;
      const receiverId = user?.villageId;

      // Guards
      if (!user || !receiverId) return errorResponse("Not in this village");
      if (!isKage(user)) return errorResponse("You are not kage");
      if (request.receiverId !== user.userId) return errorResponse("Go away");
      if (request.status !== "PENDING") return errorResponse("Request not pending");
      if (!availRequests.includes(request.type)) return errorResponse("Bad r-type");

      // Check if alliance is possible
      if (request.type === "ALLIANCE") {
        const check = canAlly(relationships, villages, senderId, receiverId);
        if (!check.success) return check;
      } else if (request.type === "SURRENDER") {
        const check = canSurrender(relationships, senderId, receiverId);
        if (!check.success) return check;
      }

      // Update
      const state = request.type === "ALLIANCE" ? "ALLY" : "NEUTRAL";
      await Promise.all([
        upsertAllianceStatus(ctx.drizzle, relationships, senderId, receiverId, state),
        updateRequestState(ctx.drizzle, input.id, "ACCEPTED", request.type),
      ]);

      // Return
      return { success: true, message: "Alliance request accepted" };
    }),
  rejectRequest: protectedProcedure
    .meta({
      mcp: { description: "Reject alliance or surrender request" },
    })
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetches
      const { user, requests } = await fetchAllienceInfo(ctx.drizzle, ctx.userId);
      // Derived
      const request = requests.find((r) => r.id === input.id);
      // Guards
      if (!user) return errorResponse("Not in this village");
      if (!isKage(user)) return errorResponse("You are not kage");
      if (!request) return errorResponse("Request not found");
      if (request.receiverId !== user.userId) return errorResponse("Go away");
      if (!availRequests.includes(request.type)) return errorResponse("Bad r-type");
      // Update
      await updateRequestState(ctx.drizzle, input.id, "REJECTED", request.type);
      return { success: true, message: "Alliance request rejected" };
    }),
  cancelRequest: protectedProcedure
    .meta({
      mcp: { description: "Cancel alliance or surrender request" },
    })
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetches
      const { user, requests } = await fetchAllienceInfo(ctx.drizzle, ctx.userId);
      // Derived
      const request = requests.find((r) => r.id === input.id);
      // Guards
      if (!user) return errorResponse("Not in this village");
      if (!isKage(user)) return errorResponse("You are not kage");
      if (!request) return errorResponse("Request not found");
      if (request.senderId !== user.userId) return errorResponse("Go away");
      if (!availRequests.includes(request.type)) return errorResponse("Bad r-type");
      // Update
      await updateRequestState(ctx.drizzle, input.id, "CANCELLED", request.type);
      return { success: true, message: "Alliance request rejected" };
    }),
  leaveAlliance: protectedProcedure
    .meta({ mcp: { description: "Leave an alliance as kage" } })
    .input(z.object({ allianceId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetches
      const { user, relationships } = await fetchAllienceInfo(ctx.drizzle, ctx.userId);
      // Derived
      const alliance = relationships.find((r) => r.id === input.allianceId);
      // Guards
      if (!user) return errorResponse("Could not find user");
      if (!user.villageId) return errorResponse("Not in this village");
      if (!alliance) return errorResponse("Alliance not found");
      if (!isKage(user)) return errorResponse("You are not kage");
      const aId = alliance.villageIdA;
      const bId = alliance.villageIdB;
      if (![aId, bId].includes(user.villageId)) return errorResponse("Not in alliance");
      // Mutate
      await upsertAllianceStatus(ctx.drizzle, relationships, aId, bId, "NEUTRAL");
      // Return
      return { success: true, message: "You have left the alliance" };
    }),
  releaseSector: protectedProcedure
    .meta({ mcp: { description: "Release sector ownership as kage" } })
    .input(z.object({ sector: z.int() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetches
      const [sectorData, { user }, villages] = await Promise.all([
        fetchSector(ctx.drizzle, input.sector),
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchVillages(ctx.drizzle),
      ]);
      // Derived
      const villageId = user?.villageId;

      // Guards
      if (!user) return errorResponse("Could not find user");
      if (!isKage(user)) return errorResponse("You are not in charge");
      if (!villageId) return errorResponse("Not in this village");
      if (!sectorData) return errorResponse("Sector not found");
      if (sectorData.villageId !== villageId) return errorResponse("Not your sector");
      if (villages?.find((v) => v.sector === input.sector)) {
        return errorResponse("Cannot clear sector with village/town/hideout in it");
      }

      // Drizzle cannot express joined deletes. The village join's shared row lock
      // coordinates with declarations' FOR UPDATE before they select objectives.
      // Recheck leadership, ownership and active objectives in the same statement.
      const released = await retryOnDeadlock(() =>
        executeReleasedForReleaseSector(ctx.drizzle, input, villageId, ctx),
      );
      if (released.rowsAffected === 0) {
        return errorResponse(
          "Sector ownership or leadership changed, or this is an active war objective. Refresh and try again.",
        );
      }
      await insertSectorReleaseLog(
        ctx.drizzle,
        ctx.userId,
        input.sector,
        sectorData.village.name,
        villageId,
      );

      // Return
      return { success: true, message: "You have released the sector" };
    }),
  declareEnemy: protectedProcedure
    .meta({ mcp: { description: "Declare another village as enemy" } })
    .input(z.object({ villageId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetches
      const { user, villages, relationships } = await fetchAllienceInfo(
        ctx.drizzle,
        ctx.userId,
      );

      // Derived
      const villageId = user?.villageId;
      const targetId = input.villageId;
      const userVillage = villages.find((v) => v.id === villageId);
      const target = villages.find((v) => v.id === targetId);

      // General guards
      if (!userVillage) return errorResponse("User village not found");
      if (!target) return errorResponse("Target village not found");
      if (!user || !villageId) return errorResponse("Not in this village");
      if (!isKage(user)) return errorResponse("You are not kage");
      if (!ALLIANCE_VILLAGE_TYPES.includes(target.type as AllianceVillageType))
        return errorResponse("Invalid target type for alliance");
      if (!ALLIANCE_VILLAGE_TYPES.includes(userVillage.type as AllianceVillageType))
        return errorResponse("Your village/faction cannot declare enemies");
      if (!userVillage.allianceSystem) return errorResponse("User Alliance disabled");
      if (!target.allianceSystem) return errorResponse("Target Alliance disabled");

      // Check if declaring enemy is possible
      const check = canEnemy(relationships, villages, villageId, targetId);
      if (!check.success) return check;

      // Mutate
      await Promise.all([
        upsertAllianceStatus(ctx.drizzle, relationships, villageId, targetId, "ENEMY"),
        ...check.newEnemies.map((id) =>
          upsertAllianceStatus(ctx.drizzle, relationships, villageId, id, "ENEMY"),
        ),
        ...check.newNeutrals.map((id) =>
          upsertAllianceStatus(ctx.drizzle, relationships, villageId, id, "NEUTRAL"),
        ),
        insertNotificationForDeclareEnemy(ctx.drizzle, ctx, userVillage, target),
        updateUserDataForDeclareEnemy(ctx.drizzle, villageId, targetId, user),
        updateVillageForDeclareEnemy(ctx.drizzle, villageId),
        updateUserDataForDeclareEnemy2(ctx.drizzle, user),
      ]);
      // Return
      return { success: true, message: "You have declared yourself an enemy" };
    }),
});

/**
 * Upserts the alliance status between two villages.
 * If an alliance relationship already exists between the villages, updates the status.
 * Otherwise, creates a new alliance relationship with the specified status.
 *
 * @param client - The DrizzleClient instance used to interact with the database.
 * @param relationships - The array of existing village alliance relationships.
 * @param villageIdA - The ID of the first village.
 * @param villageIdB - The ID of the second village.
 * @param status - The alliance status to set.
 * @returns A Promise that resolves when the operation is complete.
 */
export const upsertAllianceStatus = async (
  client: DrizzleClient,
  relationships: VillageAlliance[],
  villageIdA: string,
  villageIdB: string,
  status: AllianceState,
) => {
  const alliance = findRelationship(relationships, villageIdA, villageIdB);
  if (alliance) {
    await updateVillageAllianceForUpsertAllianceStatus(client, status, alliance);
  } else {
    await insertVillageAllianceForUpsertAllianceStatus(
      client,
      villageIdA,
      villageIdB,
      status,
    );
  }
};

/**
 * Fetches alliance information for a given user.
 *
 * @param client - The DrizzleClient instance.
 * @param userId - The ID of the user.
 * @returns An object containing the user, villages, relationships, and requests.
 */
export const fetchAllienceInfo = async (client: DrizzleClient, userId: string) => {
  const [{ user }, villages, relationships, requests] = await Promise.all([
    fetchUpdatedUser({ client, userId }),
    fetchVillages(client),
    fetchAlliances(client),
    fetchRequests(client, ["ALLIANCE", "SURRENDER"], 3600 * 48),
  ]);
  return { user, villages, relationships, requests };
};
