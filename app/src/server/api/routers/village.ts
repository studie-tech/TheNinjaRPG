import { z } from "zod";
import { nanoid } from "nanoid";
import { alias } from "drizzle-orm/mysql-core";
import { getTableColumns } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/api/trpc";
import { baseServerResponse, serverError, errorResponse } from "@/api/trpc";
import { village, villageStructure, userData, notification } from "@/drizzle/schema";
import { villageAlliance, kageDefendedChallenges, war, sector } from "@/drizzle/schema";
import { eq, sql, gte, and, or, inArray, ne, count } from "drizzle-orm";
import { ramenOptions } from "@/utils/ramen";
import { getRamenHealPercentage, calcRamenCost } from "@/utils/ramen";
import { fetchUpdatedUser, fetchUser } from "@/routers/profile";
import { fetchRequests } from "@/routers/sparring";
import { insertRequest, updateRequestState } from "@/routers/sparring";
import { createConvo } from "@/routers/comments";
import { canAccessStructure } from "@/utils/village";
import { getStrucBoost } from "@/utils/village";
import { isKage } from "@/utils/kage";
import { findRelationship } from "@/utils/alliance";
import { canAlly, canEnemy, canSurrender } from "@/utils/alliance";
import { COST_SWAP_VILLAGE, IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { ALLIANCEHALL_LONG, ALLIANCEHALL_LAT } from "@/drizzle/constants";
import { KAGE_WAR_DECLARE_COST } from "@/drizzle/constants";
import { UserRequestTypes } from "@/drizzle/constants";
import { WAR_FUNDS_COST } from "@/drizzle/constants";
import { deleteRequests } from "@/routers/sensei";
import { hasRequiredRank } from "@/libs/train";
import { canAdministrateWars } from "@/utils/permissions";
import { canSwapVillage } from "@/utils/permissions";
import { VILLAGE_LEAVE_REQUIRED_RANK } from "@/drizzle/constants";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { ALLIANCE_VILLAGE_TYPES } from "@/drizzle/constants";
import { actionLog } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import type { AllianceState, AllianceVillageType } from "@/drizzle/constants";
import type { VillageAlliance } from "@/drizzle/schema";

const availRequests = ["SURRENDER", "ALLIANCE"];

export const villageRouter = createTRPCRouter({
  // Get all village names
  getAllNames: publicProcedure.query(async ({ ctx }) => {
    return await ctx.drizzle.query.village.findMany({
      columns: { id: true, name: true },
      where: inArray(village.type, ["VILLAGE", "OUTLAW", "SAFEZONE"]),
      orderBy: (table, { asc }) => [asc(table.name)],
    });
  }),
  // Get all villages
  getAll: publicProcedure.query(async ({ ctx }) => {
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
        ctx.drizzle
          .update(villageStructure)
          .set({ curSp: sql`${villageStructure.maxSp}` })
          .where(eq(villageStructure.id, input.structureId)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "war",
          changes: [`Restored structure points for ${input.structureId}`],
          relatedId: input.structureId,
        }),
      ]);
      return { success: true, message: "Structure points restored successfully" };
    }),
  // Get a specific village & its structures∂
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Fetch in parallel
      const [villageData, sectorCount, defendedChallenges] = await Promise.all([
        fetchVillage(ctx.drizzle, input.id),
        countVillageSectors(ctx.drizzle, input.id),
        ctx.drizzle.query.kageDefendedChallenges.findMany({
          with: {
            user: {
              columns: {
                username: true,
                userId: true,
                avatar: true,
              },
            },
          },
          where: eq(kageDefendedChallenges.villageId, input.id),
          limit: 8,
          orderBy: (table, { desc }) => [desc(table.createdAt)],
        }),
      ]);

      // Guards
      if (!villageData) throw serverError("NOT_FOUND", "Village not found");

      // Return
      return { villageData, sectorCount, defendedChallenges };
    }),
  // Get sector ownership
  getSectorOwnerships: protectedProcedure
    .input(z.object({ onlyOwnWar: z.boolean() }))
    .query(async ({ ctx, input }) => {
      const [user, sectors, colors, sectorWars] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.sector.findMany({
          columns: {
            sector: true,
            villageId: true,
          },
          where: ne(sector.villageId, VILLAGE_SYNDICATE_ID),
        }),
        ctx.drizzle.query.village.findMany({
          columns: {
            id: true,
            hexColor: true,
          },
        }),
        ctx.drizzle.query.war.findMany({
          columns: {
            sector: true,
            attackerVillageId: true,
            defenderVillageId: true,
          },
          with: {
            warAllies: {
              columns: {
                villageId: true,
              },
            },
          },
          where: and(eq(war.status, "ACTIVE"), eq(war.type, "SECTOR_WAR")),
        }),
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
    .input(z.object({ ramen: z.enum(ramenOptions), villageId: z.string().nullish() }))
    .output(
      baseServerResponse.extend({
        cost: z.number().optional(),
        newHealth: z.number().optional(),
        newStamina: z.number().optional(),
        newChakra: z.number().optional(),
      }),
    )
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
      const structures = await fetchStructures(ctx.drizzle, sectorVillage?.id);
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
      const newStamina = Math.min(
        user.maxStamina,
        user.curStamina + (user.maxStamina * healPercentage) / 100,
      );
      const newChakra = Math.min(
        user.maxChakra,
        user.curChakra + (user.maxChakra * healPercentage) / 100,
      );
      const result = await ctx.drizzle
        .update(userData)
        .set({
          money: user.money - cost,
          curStamina: newStamina,
          curChakra: newChakra,
        })
        .where(and(eq(userData.userId, ctx.userId), gte(userData.money, cost)));
      if (result.rowsAffected === 0) {
        return errorResponse("Error trying to buy food. Try again.");
      } else {
        return {
          success: true,
          message: `You have bought food and healed to ${Math.floor(newStamina)}SP and ${Math.floor(newChakra)}CP`,
          cost,
          newStamina,
          newChakra,
        };
      }
    }),
  leaveVillage: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Queries
      const { user } = await fetchUpdatedUser({
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
      await ctx.drizzle
        .update(userData)
        .set({
          villageId: VILLAGE_SYNDICATE_ID,
          villagePrestige:
            user.villagePrestige >= 0 ? user.villagePrestige : -user.villagePrestige, // Converted to notoriety
          isOutlaw: true,
          joinedVillageAt: new Date(),
          ...(user.rank === "GENIN" && { senseiId: null }),
          ...(user.rank === "ELDER" && { rank: "JONIN" }),
        })
        .where(and(eq(userData.userId, ctx.userId), eq(userData.status, "AWAKE")));

      return { success: true, message: "You have left the village" };
    }),
  joinVillage: protectedProcedure
    .input(z.object({ villageId: z.string() }))
    .output(baseServerResponse)
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
      await Promise.all([
        ctx.drizzle
          .update(userData)
          .set({
            villageId: village.id,
            villagePrestige: 0,
            isOutlaw: false,
            joinedVillageAt: new Date(),
            ...(user.rank === "GENIN" && { senseiId: null }),
            ...(user.rank === "ELDER" && { rank: "JONIN" }),
          })
          .where(and(eq(userData.userId, ctx.userId), eq(userData.status, "AWAKE"))),
        // Clear current sensei requests for this user
        deleteRequests(ctx.drizzle, ctx.userId),
        // Remove the user as sensei for any active students
        ctx.drizzle
          .update(userData)
          .set({ senseiId: null })
          .where(and(eq(userData.senseiId, ctx.userId), eq(userData.rank, "GENIN"))),
      ]);
      return { success: true, message: "You have joined the village" };
    }),
  swapVillage: protectedProcedure
    .input(z.object({ villageId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Queries
      const { user } = await fetchUpdatedUser({
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
      await Promise.all([
        ctx.drizzle
          .update(userData)
          .set({
            villageId: village.id,
            reputationPoints: user.reputationPoints - cost,
            isOutlaw: village.type === "OUTLAW" ? true : false,
            sector: village.sector,
            longitude: ALLIANCEHALL_LONG,
            latitude: ALLIANCEHALL_LAT,
            ...(user.rank === "GENIN" && { senseiId: null }),
            ...(user.rank === "ELDER" && { rank: "JONIN" }),
          })
          .where(
            and(
              eq(userData.userId, ctx.userId),
              gte(userData.reputationPoints, cost),
              eq(userData.status, "AWAKE"),
            ),
          ),
        // Clear current sensei requests for this user
        deleteRequests(ctx.drizzle, ctx.userId),
        // Remove the user as sensei for any active students
        ctx.drizzle
          .update(userData)
          .set({ senseiId: null })
          .where(and(eq(userData.senseiId, ctx.userId), eq(userData.rank, "GENIN"))),
      ]);

      return { success: true, message: "You have swapped villages" };
    }),
  getAlliances: publicProcedure.query(async ({ ctx }) => {
    const [villages, relationships, requests] = await Promise.all([
      fetchVillages(ctx.drizzle),
      fetchAlliances(ctx.drizzle),
      fetchRequests(ctx.drizzle, ["ALLIANCE", "SURRENDER"], 3600 * 48),
    ]);
    return { villages, relationships, requests };
  }),
  getVillageStructures: publicProcedure
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await fetchStructures(ctx.drizzle, input.villageId);
    }),
  createRequest: protectedProcedure
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
    .input(z.object({ id: z.string() }))
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
    .input(z.object({ id: z.string() }))
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
    .input(z.object({ id: z.string() }))
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
    .input(z.object({ sector: z.number().int() }))
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

      // Mutate
      await Promise.all([
        ctx.drizzle.delete(sector).where(eq(sector.sector, input.sector)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "war",
          changes: [`Released sector ${input.sector} from ${sectorData.village.name}`],
          relatedId: villageId,
          relatedMsg: `Released sector ${input.sector}`,
          relatedImage: IMG_AVATAR_DEFAULT,
        }),
      ]);

      // Return
      return { success: true, message: "You have released the sector" };
    }),
  declareEnemy: protectedProcedure
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
        ctx.drizzle.insert(notification).values({
          userId: ctx.userId,
          content: `${userVillage.name} has declared war on ${target.name}`,
        }),
        ctx.drizzle
          .update(userData)
          .set({ unreadNotifications: sql`unreadNotifications + 1` }),
        ctx.drizzle
          .update(village)
          .set({ tokens: sql`${village.tokens} - ${WAR_FUNDS_COST}` })
          .where(eq(village.id, villageId)),
        ctx.drizzle
          .update(userData)
          .set({
            villagePrestige: sql`${userData.villagePrestige} - ${KAGE_WAR_DECLARE_COST}`,
          })
          .where(eq(userData.userId, user.userId)),
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
    await client
      .update(villageAlliance)
      .set({ status })
      .where(eq(villageAlliance.id, alliance.id));
  } else {
    await client
      .insert(villageAlliance)
      .values({ id: nanoid(), villageIdA, villageIdB, status });
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

/**
 * Fetches all alliances from the database.
 *
 * @param client - The DrizzleClient instance used to query the database.
 * @returns A promise that resolves to an array of alliance objects.
 */
export const fetchAlliances = async (client: DrizzleClient) => {
  const villageA = alias(village, "villageA");
  const villageB = alias(village, "villageB");
  return await client
    .select(getTableColumns(villageAlliance))
    .from(villageAlliance)
    .innerJoin(villageA, eq(villageA.id, villageAlliance.villageIdA))
    .innerJoin(villageB, eq(villageB.id, villageAlliance.villageIdB))
    .where(and(eq(villageA.allianceSystem, true), eq(villageB.allianceSystem, true)));
};

/**
 * Fetches a village from the database.
 *
 * @param client - The DrizzleClient instance used to query the database.
 * @param villageId - The ID of the village to fetch.
 * @returns A Promise that resolves to the fetched village.
 */
export const fetchVillage = async (client: DrizzleClient, villageId: string) => {
  return await client.query.village.findFirst({
    where: eq(village.id, villageId),
    with: {
      notice: true,
      relationshipA: true,
      relationshipB: true,
      structures: {
        orderBy: (structure, { desc }) => desc(structure.name),
      },
      kage: {
        columns: {
          username: true,
          userId: true,
          avatar: true,
        },
      },
    },
  });
};

/**
 * Fetches a sector village from the database.
 *
 * @param client - The DrizzleClient instance used to query the database.
 * @param sector - The sector number of the village to fetch.
 * @returns A Promise that resolves to the fetched village.
 */
export const fetchSectorVillage = async (
  client: DrizzleClient,
  sector: number,
  isOutlaw = false,
) => {
  const result = await client.query.village.findFirst({
    where: !isOutlaw
      ? eq(village.sector, sector)
      : or(
          and(eq(village.sector, sector), eq(village.type, "SAFEZONE")),
          and(eq(village.sector, sector), eq(village.type, "HIDEOUT")),
          and(eq(village.sector, sector), eq(village.type, "TOWN")),
          eq(village.type, "OUTLAW"),
        ),
    orderBy: (villages) =>
      sql`FIELD(${villages.type}, 'SAFEZONE', 'HIDEOUT', 'TOWN', 'OUTLAW')`,
    with: {
      notice: true,
      relationshipA: true,
      relationshipB: true,
      structures: {
        orderBy: (structure, { desc }) => desc(structure.name),
      },
      kage: {
        columns: {
          username: true,
          userId: true,
          avatar: true,
        },
      },
    },
  });
  return result || null;
};

/**
 * Fetches villages from the server.
 * @param client - The DrizzleClient instance used for querying the server.
 * @returns A promise that resolves to an array of villages, including the associated kage information.
 */
export const fetchVillages = async (client: DrizzleClient) => {
  return await client.query.village.findMany({
    with: { kage: { columns: { username: true, userId: true, avatar: true } } },
  });
};

/**
 * Fetches structures for a given village.
 * @param client - The DrizzleClient instance used for querying.
 * @param villageId - The ID of the village to fetch structures for.
 * @returns A promise that resolves to an array of structures.
 */
export const fetchStructures = async (
  client: DrizzleClient,
  villageId?: string | null,
) => {
  return await client.query.villageStructure.findMany({
    where: eq(villageStructure.villageId, villageId ?? VILLAGE_SYNDICATE_ID),
  });
};

/**
 * Fetches a village structure from the database.
 * @param client - The DrizzleClient instance used to query the database.
 * @param structureId - The ID of the structure to fetch.
 * @returns A Promise that resolves to the fetched village structure.
 */
export const fetchStructure = async (client: DrizzleClient, structureId: string) => {
  return await client.query.villageStructure.findFirst({
    where: eq(villageStructure.id, structureId),
  });
};

/**
 * Counts the number of sectors a village has.
 * @param client - The DrizzleClient instance used to query the database.
 * @param villageId - The ID of the village to count sectors for.
 * @returns The number of sectors a village has.
 */
export const countVillageSectors = async (
  client: DrizzleClient,
  villageId: string | null,
) => {
  if (!villageId) return 0;
  const counts = await client
    .select({ count: count() })
    .from(sector)
    .where(eq(sector.villageId, villageId));
  return counts?.[0]?.count || 0;
};

/**
 * Fetches a sector from the database.
 * @param client - The DrizzleClient instance used to query the database.
 * @param sectorId - The ID of the sector to fetch.
 * @returns A Promise that resolves to the fetched sector.
 */
export const fetchSector = async (client: DrizzleClient, sectorId: number) => {
  return await client.query.sector.findFirst({
    columns: {
      sector: true,
      villageId: true,
      shrineLevel: true,
      capturedAt: true,
    },
    with: { village: { columns: { name: true, id: true } } },
    where: eq(sector.sector, sectorId),
  });
};
