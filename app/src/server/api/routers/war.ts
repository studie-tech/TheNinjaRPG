import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { baseServerResponse, errorResponse } from "../trpc";
import { eq, and, gte, ne, desc } from "drizzle-orm";
import {
  war,
  village,
  warAlly,
  warKill,
  sector,
  userData,
  actionLog,
} from "@/drizzle/schema";
import { fetchUpdatedUser, fetchUser } from "@/routers/profile";
import { fetchVillages, fetchAlliances, fetchStructures } from "@/routers/village";
import { nanoid } from "nanoid";
import type { DrizzleClient } from "@/server/db";
import { canAdministrateWars } from "@/utils/permissions";
import {
  WAR_DECLARATION_COST,
  VILLAGE_SYNDICATE_ID,
  WAR_PURCHASE_SHRINE_TOKEN_COST,
  MAP_RESERVED_SECTORS,
  WAR_VILLAGE_MAX_SECTORS,
  WAR_FACTION_MAX_SECTORS,
  WAR_EXHAUSTION_DURATION_DAYS,
  WAR_MINIMUM_TOKENS_FOR_BEING_ATTACKABLE,
  SHRINE_MAX_PER_VILLAGE,
} from "@/drizzle/constants";
import {
  handleWarEnd,
  canJoinWar,
  resetStructuresWhenNotInWar,
  getShrineHpByLevel,
} from "@/libs/war";
import { sql } from "drizzle-orm";
import {
  insertRequest,
  updateRequestState,
  fetchRequest,
  fetchRequests,
} from "@/routers/sparring";
import { findRelationship } from "@/utils/alliance";
import { isKage } from "@/utils/kage";
import { countVillageSectors, fetchSector } from "@/routers/village";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import type { War, WarAlly, Village, VillageStructure } from "@/drizzle/schema";
import type { RouterOutputs } from "@/app/_trpc/client";

export const warRouter = createTRPCRouter({
  // Get active wars for a village
  getActiveWars: protectedProcedure
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await fetchActiveWars(ctx.drizzle, input.villageId);
    }),

  // Get ended wars for a village
  getEndedWars: protectedProcedure
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      return fetchEndedWars(ctx.drizzle, input.villageId);
    }),

  adminEndWar: protectedProcedure
    .input(z.object({ warId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, activeWar] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchActiveWar(ctx.drizzle, input.warId),
      ]);
      // Guard
      if (!user) return errorResponse("User not found");
      if (!activeWar) return errorResponse("War not found");
      if (!canAdministrateWars(user.role)) {
        return errorResponse("You are not authorized to end wars");
      }
      // End war
      await Promise.all([
        ctx.drizzle.delete(war).where(eq(war.id, input.warId)),
        ctx.drizzle.delete(warKill).where(eq(warKill.warId, input.warId)),
        ctx.drizzle.delete(warAlly).where(eq(warAlly.warId, input.warId)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "war",
          changes: [
            `Ended war between ${activeWar.attackerVillage?.name ?? "Unknown"} and ${activeWar.defenderVillage?.name ?? "Unknown"}`,
          ],
          relatedId: input.warId,
          relatedMsg: `Ended war`,
          relatedImage: IMG_AVATAR_DEFAULT,
        }),
      ]);
      return { success: true, message: "War ended successfully" };
    }),

  buildShrine: protectedProcedure
    .input(z.object({ warId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, activeWar] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchActiveWar(ctx.drizzle, input.warId),
      ]);

      // Guard
      if (!user?.village) {
        return errorResponse("You must be in a village to build a shrine");
      }
      if (!user?.villageId) {
        return errorResponse("You must be in a village to build a shrine");
      }
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the Kage can build shrines");
      }
      if (!activeWar) {
        return errorResponse("War not found");
      }
      if (activeWar.status !== "ACTIVE") {
        return errorResponse("War is not active");
      }
      if (activeWar.type !== "SECTOR_WAR") {
        return errorResponse("War is not a sector war");
      }
      if (activeWar.shrineHp > 0) {
        return errorResponse("Shrine is still standing");
      }
      if (MAP_RESERVED_SECTORS.includes(activeWar.sector)) {
        return errorResponse("Shrine cannot be built on reserved sectors");
      }
      if (user.village.tokens < WAR_PURCHASE_SHRINE_TOKEN_COST) {
        return errorResponse(
          `Your village needs ${WAR_PURCHASE_SHRINE_TOKEN_COST} tokens to build a shrine`,
        );
      }
      if (activeWar.attackerVillageId !== user.villageId) {
        return errorResponse("Only the attacking village can build shrines");
      }

      // First deduct the price
      const result = await ctx.drizzle
        .update(village)
        .set({ tokens: user.village.tokens - WAR_PURCHASE_SHRINE_TOKEN_COST })
        .where(
          and(
            eq(village.id, user.villageId),
            gte(village.tokens, WAR_PURCHASE_SHRINE_TOKEN_COST),
          ),
        );
      if (result.rowsAffected === 0) {
        return errorResponse("Not enough tokens to build a shrine");
      }

      // Handle war end
      activeWar.defenderVillage.tokens = 0;
      await handleWarEnd(activeWar);
      return { success: true, message: "Shrine built successfully" };
    }),

  declareSectorWar: protectedProcedure
    .input(z.object({ sectorId: z.number(), userVillageId: z.string().nullable() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, activeWars, villages, relationships, targetSector, sectorCount] =
        await Promise.all([
          fetchUpdatedUser({
            client: ctx.drizzle,
            userId: ctx.userId,
          }),
          fetchActiveWars(ctx.drizzle),
          fetchVillages(ctx.drizzle),
          fetchAlliances(ctx.drizzle),
          fetchSector(ctx.drizzle, input.sectorId),
          countVillageSectors(ctx.drizzle, input.userVillageId),
        ]);
      // Derived
      const now = new Date();
      const attackerVillage = villages.find((v) => v.id === user?.village?.id);
      const defenderVillage = villages.find((v) => v.id === targetSector?.villageId);
      const defenderVillageId = defenderVillage?.id || VILLAGE_SYNDICATE_ID;
      const relationship = findRelationship(
        relationships,
        attackerVillage?.id || "",
        defenderVillageId,
      );
      const activeSectorWars = activeWars.filter(
        (w) =>
          (w.attackerVillageId === user?.village?.id ||
            w.defenderVillageId === user?.village?.id) &&
          w.type === "SECTOR_WAR",
      );
      const sectorVillage = villages.find((v) => v.sector === input.sectorId);
      // Guard
      if (!user?.village) {
        return errorResponse("You must be in a village to declare war");
      }
      if (sectorVillage) {
        return errorResponse("This sector is already occupied");
      }
      if (input.userVillageId && input.userVillageId !== user.villageId) {
        return errorResponse(
          "Your village does not seem to match that on your profile",
        );
      }
      if (!user?.villageId) {
        return errorResponse("You must be in a village to declare war");
      }
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the leader can declare sector wars");
      }
      if (user.village.tokens < WAR_DECLARATION_COST) {
        return errorResponse("Your village needs 15,000 tokens to declare war");
      }
      if (!attackerVillage) {
        return errorResponse("Village not found");
      }
      if (relationship && relationship?.status !== "ENEMY") {
        return errorResponse("You can only declare war on enemy villages");
      }
      if (MAP_RESERVED_SECTORS.includes(input.sectorId)) {
        return errorResponse("This sector is reserved and cannot be claimed");
      }
      if (
        targetSector &&
        attackerVillage.warExhaustionEndedAt &&
        attackerVillage.warExhaustionEndedAt > now
      ) {
        return errorResponse("Your village is under war exhaustion");
      }
      if (attackerVillage.id === defenderVillageId) {
        return errorResponse("You cannot declare sector war on your own sector");
      }
      if (
        activeWars.find(
          (w) =>
            w.attackerVillageId === user?.village?.id && w.sector === input.sectorId,
        )
      ) {
        return errorResponse("You are already at war for this sector");
      }
      if (activeSectorWars.length > 0) {
        return errorResponse(
          `You are already in a sector war for sector ${activeSectorWars.map((w) => w.sector).join(", ")}`,
        );
      }
      if (activeSectorWars.length >= SHRINE_MAX_PER_VILLAGE) {
        return errorResponse(
          `You can only own ${SHRINE_MAX_PER_VILLAGE} sectors at a time`,
        );
      }
      if (user.isOutlaw && sectorCount >= WAR_FACTION_MAX_SECTORS) {
        return errorResponse(
          `Your faction has too many sectors. Can max own ${WAR_FACTION_MAX_SECTORS} sectors`,
        );
      }
      if (!user.isOutlaw && sectorCount >= WAR_VILLAGE_MAX_SECTORS) {
        return errorResponse(
          `Your village has too many sectors. Can max own ${WAR_VILLAGE_MAX_SECTORS} sectors`,
        );
      }
      if (
        activeWars.find(
          (w) =>
            (w.attackerVillageId === user?.village?.id &&
              w.defenderVillageId === defenderVillageId) ||
            (w.attackerVillageId === defenderVillageId &&
              w.defenderVillageId === user?.village?.id),
        )
      ) {
        return errorResponse("You are already at war against the owner village.");
      }
      
      // Check if attacker village is already involved in any active war
      if (
        activeWars.find(
          (w) =>
            w.attackerVillageId === user?.village?.id ||
            w.defenderVillageId === user?.village?.id ||
            w.warAllies.some((ally) => ally.villageId === user?.village?.id)
        )
      ) {
        return errorResponse("Your village is already involved in an active war");
      }
      
      // Check if target village is already involved in any active war
      if (
        activeWars.find(
          (w) =>
            w.attackerVillageId === defenderVillageId ||
            w.defenderVillageId === defenderVillageId ||
            w.warAllies.some((ally) => ally.villageId === defenderVillageId)
        )
      ) {
        return errorResponse("Target village is already involved in an active war");
      }

      // Create war and deduct tokens
      const warId = nanoid();
      const [updateResult] = await Promise.all([
        ctx.drizzle
          .update(village)
          .set({ tokens: attackerVillage.tokens - WAR_DECLARATION_COST })
          .where(
            and(
              eq(village.id, user.villageId),
              gte(village.tokens, WAR_DECLARATION_COST),
            ),
          ),
        ctx.drizzle.insert(war).values({
          id: warId,
          attackerVillageId: user.villageId,
          defenderVillageId: defenderVillageId,
          status: "ACTIVE",
          type: "SECTOR_WAR",
          sector: input.sectorId,
          shrineHp: getShrineHpByLevel(targetSector?.shrineLevel),
          shrineMaxHp: getShrineHpByLevel(targetSector?.shrineLevel),
          dailyTokenReduction: 1000,
        }),
        ...(!targetSector
          ? [
              ctx.drizzle.insert(sector).values({
                sector: input.sectorId,
                villageId: defenderVillageId,
              }),
            ]
          : []),
      ]);
      if (updateResult.rowsAffected === 0) {
        await ctx.drizzle.delete(war).where(eq(war.id, warId));
        return errorResponse("Not enough tokens to declare sector war");
      }
      return {
        success: true,
        message: "Sector war declared successfully",
      };
    }),

  // Declare war on another village
  declareVillageWarOrRaid: protectedProcedure
    .input(z.object({ targetVillageId: z.string(), targetStructureRoute: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, activeWars, villages, relationships, structures] =
        await Promise.all([
          fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
          fetchActiveWars(ctx.drizzle),
          fetchVillages(ctx.drizzle),
          fetchAlliances(ctx.drizzle),
          fetchStructures(ctx.drizzle, input.targetVillageId),
        ]);
      // Derived
      const now = new Date();
      const attackerVillage = villages.find((v) => v.id === user?.village?.id);
      const defenderVillage = villages.find((v) => v.id === input.targetVillageId);
      const relationship = findRelationship(
        relationships,
        attackerVillage?.id || "",
        defenderVillage?.id || "",
      );
      const targetIsOutlaw = ["TOWN", "HIDEOUT", "OUTLAW"].includes(
        defenderVillage?.type || "",
      );
      const isRaid = user?.isOutlaw || targetIsOutlaw;
      const warType = isRaid ? "WAR_RAID" : "VILLAGE_WAR";
      const relationshipStatus = isRaid ? "ENEMY" : relationship?.status;
      const structure = structures.find((s) => s.route === input.targetStructureRoute);
      // Guard
      if (!user?.village) {
        return errorResponse("You must be in a village to declare war");
      }
      if (!user?.villageId) {
        return errorResponse("You must be in a village to declare war");
      }
      if (!structure) {
        return errorResponse("Structure not found");
      }
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the leader can declare war");
      }
      if (user.village.tokens < WAR_DECLARATION_COST) {
        return errorResponse("Your village needs 15,000 tokens to declare war");
      }
      if (!attackerVillage || !defenderVillage) {
        return errorResponse("Village not found");
      }
      if (relationshipStatus !== "ENEMY") {
        return errorResponse("You can only declare war on enemy villages");
      }
      if (!["VILLAGE", "TOWN", "HIDEOUT"].includes(attackerVillage.type)) {
        return errorResponse("You cannot declare war on this type of village");
      }
      if (!["VILLAGE", "TOWN", "HIDEOUT"].includes(defenderVillage.type)) {
        return errorResponse("You cannot declare war on this type of village");
      }
      if (defenderVillage.tokens < WAR_MINIMUM_TOKENS_FOR_BEING_ATTACKABLE) {
        return errorResponse(
          `Target village needs ${WAR_MINIMUM_TOKENS_FOR_BEING_ATTACKABLE.toLocaleString()} tokens to declare war`,
        );
      }
      if (!attackerVillage.allianceSystem && warType === "VILLAGE_WAR") {
        return errorResponse("Your village is not part of the alliance system");
      }
      if (!defenderVillage.allianceSystem && warType === "VILLAGE_WAR") {
        return errorResponse("Target village is not part of the alliance system");
      }
      if (
        attackerVillage.warExhaustionEndedAt &&
        attackerVillage.warExhaustionEndedAt > now
      ) {
        return errorResponse("Your village is under war exhaustion");
      }
      if (
        defenderVillage.warExhaustionEndedAt &&
        defenderVillage.warExhaustionEndedAt > now
      ) {
        return errorResponse("Target village is under war exhaustion");
      }
      if (attackerVillage.id === defenderVillage.id) {
        return errorResponse("You cannot declare war on your own village");
      }
      if (
        activeWars.find(
          (w) =>
            (w.type === "VILLAGE_WAR" &&
              w.attackerVillageId === user?.village?.id &&
              w.defenderVillageId === input.targetVillageId) ||
            (w.type === "VILLAGE_WAR" &&
              w.attackerVillageId === input.targetVillageId &&
              w.defenderVillageId === user?.village?.id),
        )
      ) {
        return errorResponse("You are already at war with this village");
      }
      if (
        activeWars.find((w) =>
          w.warAllies.some(
            (f) =>
              f.villageId === user?.village?.id &&
              f.supportVillageId === input.targetVillageId,
          ),
        )
      ) {
        return errorResponse("You are already supporting this village");
      }
      if (
        activeWars.find(
          (w) =>
            w.type === "WAR_RAID" &&
            w.attackerVillageId === user?.village?.id &&
            w.defenderVillageId === input.targetVillageId &&
            w.targetStructureRoute === input.targetStructureRoute,
        )
      ) {
        return errorResponse("You are already raiding this village structure");
      }
      
      // Check if attacker village is already involved in any active war
      if (
        activeWars.find(
          (w) =>
            w.attackerVillageId === user?.village?.id ||
            w.defenderVillageId === user?.village?.id ||
            w.warAllies.some((ally) => ally.villageId === user?.village?.id)
        )
      ) {
        return errorResponse("Your village is already involved in an active war");
      }
      
      // Check if target village is already involved in any active war
      if (
        activeWars.find(
          (w) =>
            w.attackerVillageId === input.targetVillageId ||
            w.defenderVillageId === input.targetVillageId ||
            w.warAllies.some((ally) => ally.villageId === input.targetVillageId)
        )
      ) {
        return errorResponse("Target village is already involved in an active war");
      }

      // Create war and deduct tokens
      const warId = nanoid();
      const [updateResult] = await Promise.all([
        ctx.drizzle
          .update(village)
          .set({ tokens: attackerVillage.tokens - WAR_DECLARATION_COST })
          .where(
            and(
              eq(village.id, user.villageId),
              gte(village.tokens, WAR_DECLARATION_COST),
            ),
          ),
        ctx.drizzle.insert(war).values({
          id: warId,
          attackerVillageId: user.villageId,
          defenderVillageId: input.targetVillageId,
          status: "ACTIVE",
          type: warType,
          dailyTokenReduction: 1000,
          targetStructureRoute: structure.route,
        }),
      ]);
      if (updateResult.rowsAffected === 0) {
        await ctx.drizzle.delete(war).where(eq(war.id, warId));
        return errorResponse("Not enough tokens to declare war");
      }
      return {
        success: true,
        message: "War declared successfully",
      };
    }),

  // Create an offer for factions to join the war
  createAllyOffer: protectedProcedure
    .input(
      z.object({
        warId: z.string(),
        tokenOffer: z.number().int().min(1000),
        targetVillageId: z.string(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, activeWar, villages, relationships] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchActiveWar(ctx.drizzle, input.warId),
        fetchVillages(ctx.drizzle),
        fetchAlliances(ctx.drizzle),
      ]);
      // Derived
      const targetVillage = villages.find((v) => v.id === input.targetVillageId);
      // Guard
      if (!user?.village || !user?.villageId) {
        return errorResponse("You must be in a village to create faction offers");
      }
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the Kage can create faction offers");
      }
      if (!activeWar) {
        return errorResponse("War not found");
      }
      if (activeWar.status !== "ACTIVE") {
        return errorResponse("War is not active");
      }
      if (activeWar.type !== "VILLAGE_WAR") {
        return errorResponse("War is not a village war");
      }
      if (
        ![activeWar.attackerVillageId, activeWar.defenderVillageId].includes(
          user.villageId,
        )
      ) {
        return errorResponse("You are not part of this war");
      }
      if (user.village.tokens < input.tokenOffer) {
        return errorResponse("Not enough tokens to create offer");
      }
      
      // Check if payment exceeds 20% of village tokens
      const maxPayment = Math.floor(user.village.tokens * 0.2);
      if (input.tokenOffer > maxPayment) {
        return errorResponse(
          `Payment cannot exceed 20% of village tokens (max: ${maxPayment.toLocaleString()})`
        );
      }
      if (!targetVillage) {
        return errorResponse("Target village not found");
      }
      if (
        [activeWar.attackerVillageId, activeWar.defenderVillageId].includes(
          input.targetVillageId,
        )
      ) {
        return errorResponse("Cannot create offer for a village already in the war");
      }
      
      // Check if target village is already involved in any other active war
      const allActiveWars = await fetchActiveWars(ctx.drizzle);
      if (
        allActiveWars.find(
          (w) =>
            w.id !== activeWar.id &&
            (w.attackerVillageId === input.targetVillageId ||
              w.defenderVillageId === input.targetVillageId ||
              w.warAllies.some((ally) => ally.villageId === input.targetVillageId))
        )
      ) {
        return errorResponse("Target village is already involved in another active war");
      }
      // Final checks
      const { check, message } = canJoinWar(
        activeWar,
        relationships,
        targetVillage,
        user.village,
      );
      if (!check) {
        return errorResponse(message);
      }
      // Insert request
      await insertRequest(
        ctx.drizzle,
        user.userId,
        targetVillage.kageId,
        "WAR_ALLY",
        input.tokenOffer,
        activeWar.id,
      );

      // Return
      return { success: true, message: "Ally offer sent" };
    }),

  rejectAllyOffer: protectedProcedure
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetches
      const [{ user }, request] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchRequest(ctx.drizzle, input.id, "WAR_ALLY"),
      ]);

      // Guards
      if (!user?.villageId) return errorResponse("Not in a village");
      if (!isKage(user)) return errorResponse("Not kage");
      if (!request) return errorResponse("Request not found");
      if (request.type !== "WAR_ALLY") return errorResponse("Not a war ally request");
      if (request.status !== "PENDING") return errorResponse("Request not pending");
      if (request.receiverId !== user.userId) return errorResponse("Not your request");

      // Update request
      await updateRequestState(ctx.drizzle, request.id, "REJECTED", "WAR_ALLY");

      // Return
      return { success: true, message: "Faction offer rejected" };
    }),

  // Get faction offers for a war
  getAllyOffers: protectedProcedure.query(async ({ ctx }) => {
    return await fetchRequests(ctx.drizzle, ["WAR_ALLY"], 3600 * 12, ctx.userId);
  }),

  // Delist a faction offer
  cancelAllyOffer: protectedProcedure
    .input(z.object({ offerId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, offer] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchRequest(ctx.drizzle, input.offerId, "WAR_ALLY"),
      ]);

      // Guard
      if (!offer) {
        return errorResponse("Offer not found");
      }
      if (!user?.village) {
        return errorResponse("You must be in a village to delist offers");
      }
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the Kage can delist offers");
      }
      if (offer.senderId !== user.userId) {
        return errorResponse("Not your offer to delist");
      }

      // Update request
      await updateRequestState(ctx.drizzle, input.offerId, "CANCELLED", "WAR_ALLY");

      return { success: true, message: "Offer delisted" };
    }),

  // Accept a faction offer
  acceptAllyOffer: protectedProcedure
    .input(z.object({ offerId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, activeWars, request, relationships] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchActiveWars(ctx.drizzle),
        fetchRequest(ctx.drizzle, input.offerId, "WAR_ALLY"),
        fetchAlliances(ctx.drizzle),
      ]);
      // Derived
      const warId = request.relatedId;
      const activeWar = activeWars.find(
        (w) =>
          (w.attackerVillage?.kageId === request.senderId ||
            w.defenderVillage?.kageId === request.senderId) &&
          w.id === warId,
      );
      const senderVillage =
        activeWar?.attackerVillage?.kageId === request.senderId
          ? activeWar?.attackerVillage
          : activeWar?.defenderVillage;
      // Guard
      if (!request) {
        return errorResponse("Offer not found");
      }
      if (!senderVillage) {
        return errorResponse("Sender village not found");
      }
      if (!user?.villageId) {
        return errorResponse("You must be in a village or faction to accept offers");
      }
      if (!user?.village) {
        return errorResponse("You must be in a village or faction to accept offers");
      }
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the leader can accept offers");
      }
      if (!activeWar) {
        return errorResponse("No active war found for the one listing the offer");
      }
      if (activeWar.status !== "ACTIVE") {
        return errorResponse("War is not active");
      }
      if (activeWar.type !== "VILLAGE_WAR") {
        return errorResponse("War is not a village war");
      }
      if (request.receiverId !== user.userId) {
        return errorResponse("This offer is not for your village");
      }
      if (request.senderId === user.userId) {
        return errorResponse("Cannot accept your own offer");
      }
      if (activeWar.warAllies.some((f) => f.villageId === user.villageId)) {
        return errorResponse("Already joined this war");
      }
      // Final checks
      const { check, message } = canJoinWar(
        activeWar,
        relationships,
        user.village,
        senderVillage,
      );
      if (!check) return errorResponse(message);
      // Create ally and delete offer
      await Promise.all([
        ctx.drizzle.insert(warAlly).values({
          id: nanoid(),
          warId: activeWar.id,
          villageId: user.villageId,
          supportVillageId: senderVillage.id,
          tokensPaid: request.value || 0,
        }),
        ctx.drizzle
          .update(village)
          .set({ tokens: sql`tokens + ${request.value}` })
          .where(eq(village.id, user.villageId)),
        ctx.drizzle
          .update(village)
          .set({ tokens: sql`tokens - ${request.value}` })
          .where(eq(village.kageId, request.senderId)),
        updateRequestState(ctx.drizzle, input.offerId, "ACCEPTED", "WAR_ALLY"),
      ]);

      return { success: true, message: "Offer accepted and alliance formed" };
    }),

  // Surrender war
  surrender: protectedProcedure
    .input(z.object({ warId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, activeWars] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchActiveWars(ctx.drizzle),
        fetchVillages(ctx.drizzle),
      ]);
      // Derived
      const activeWar = activeWars.find((w) => w.id === input.warId);
      const isMainCompetitor = [
        activeWar?.attackerVillageId,
        activeWar?.defenderVillageId,
      ].includes(user?.villageId || "unknown");
      const warAllyData = activeWar?.warAllies.find(
        (f) => f.villageId === user?.villageId,
      );
      // Guard
      if (!user?.village) {
        return errorResponse("You must be in a village to surrender");
      }
      if (!user?.villageId) {
        return errorResponse("You must be in a village to surrender");
      }
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the Kage can surrender");
      }
      if (!activeWar) {
        return errorResponse("Active war was not found");
      }
      if (activeWar.status !== "ACTIVE") {
        return errorResponse("War is not active");
      }
      if (!["WAR_RAID", "VILLAGE_WAR"].includes(activeWar.type)) {
        return errorResponse("Cannot surrender this type of war");
      }
      // Mutate
      if (isMainCompetitor) {
        // Main participant surrendering
        if (user.villageId === activeWar.attackerVillageId) {
          activeWar.attackerVillage.tokens = 0;
        } else {
          activeWar.defenderVillage.tokens = 0;
        }
        await handleWarEnd(activeWar);
      } else if (warAllyData) {
        // Ally surrendering
        const endedAt = new Date();
        const warExhaustionEnd = new Date(
          endedAt.getTime() + WAR_EXHAUSTION_DURATION_DAYS * 24 * 60 * 60 * 1000,
        );
        await Promise.all([
          ctx.drizzle.delete(warAlly).where(eq(warAlly.id, warAllyData.id)),
          ctx.drizzle
            .update(village)
            .set({
              warExhaustionEndedAt: warExhaustionEnd,
              lastWarEndedAt: endedAt,
            })
            .where(eq(village.id, user.villageId)),
        ]);
      } else {
        // Not part of the war
        return errorResponse("You are not part of this war");
      }
      return { success: true, message: "War surrendered and therefore lost" };
    }),

  getWarKills: protectedProcedure
    .input(z.object({ warId: z.string() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.drizzle.query.warKill.findMany({
        where: eq(warKill.warId, input.warId),
        with: {
          killer: { columns: { userId: true, avatar: true, username: true } },
          victim: { columns: { userId: true, avatar: true, username: true } },
          killerVillage: { columns: { id: true, name: true } },
          victimVillage: { columns: { id: true, name: true } },
        },
        orderBy: [desc(warKill.killedAt)],
      });
      // Ensure killer and victim are not null
      return results.filter((kill) => kill.killer && kill.victim);
    }),

  getWarKillStats: protectedProcedure
    .input(
      z.object({
        warId: z.string(),
        aggregateBy: z.enum(["townhallHpChange", "shrineHpChange", "totalKills"]),
      }),
    )
    .query(async ({ ctx, input }) => {
      // If total kills
      if (input.aggregateBy === "totalKills") {
        return await ctx.drizzle
          .select({
            killerId: warKill.killerId,
            killerUsername: userData.username,
            villageId: userData.villageId,
            villageName: village.name,
            killerAvatar: userData.avatar,
            count: sql<number>`count(*)`,
          })
          .from(warKill)
          .leftJoin(userData, eq(warKill.killerId, userData.userId))
          .leftJoin(village, eq(userData.villageId, village.id))
          .where(eq(warKill.warId, input.warId))
          .groupBy(warKill.killerId)
          .orderBy(desc(sql<number>`count(*)`));
      }

      // Other aggregate fields
      const aggregateField =
        input.aggregateBy === "townhallHpChange"
          ? warKill.townhallHpChange
          : warKill.shrineHpChange;

      return await ctx.drizzle
        .select({
          killerId: warKill.killerId,
          killerUsername: userData.username,
          villageId: userData.villageId,
          villageName: village.name,
          killerAvatar: userData.avatar,
          count: sql<number>`sum(${aggregateField})`,
        })
        .from(warKill)
        .leftJoin(userData, eq(warKill.killerId, userData.userId))
        .leftJoin(village, eq(userData.villageId, village.id))
        .where(eq(warKill.warId, input.warId))
        .groupBy(warKill.killerId)
        .orderBy(desc(sql<number>`sum(${aggregateField})`));
    }),
});

/**
 * Fetch active wars for a village
 * @param client - The database client
 * @param villageId - The ID of the village
 * @returns The active wars
 */
export const fetchActiveWars = async (client: DrizzleClient, villageId?: string) => {
  // Fetch from database the active ones
  let activeWars = await client.query.war.findMany({
    where: eq(war.status, "ACTIVE"),
    with: {
      attackerVillage: {
        with: { structures: true },
      },
      defenderVillage: {
        with: { structures: true },
      },
      warAllies: {
        with: {
          village: true,
        },
      },
    },
  });
  // Process the wars and end the ones that need to be ended
  activeWars = await Promise.all(
    activeWars
      .filter((war) => war.attackerVillage && war.defenderVillage)
      .map((war) => {
        // If townhall is destroyed, set tokens to 0 (without updating database), which will trigger war end
        if (["VILLAGE_WAR", "WAR_RAID"].includes(war.type)) {
          const attackerTownhall = war.attackerVillage.structures.find(
            (s) => s.route === war.targetStructureRoute,
          );
          const defenderTownhall = war.defenderVillage?.structures.find(
            (s) => s.route === war.targetStructureRoute,
          );
          if (attackerTownhall && attackerTownhall.curSp <= 0) {
            war.attackerVillage.tokens = 0;
          }
          if (defenderTownhall && defenderTownhall.curSp <= 0) {
            war.defenderVillage.tokens = 0;
          }
        }
        // Update war
        if (war.attackerVillage.tokens <= 0 || war.defenderVillage.tokens <= 0) {
          return handleWarEnd(war);
        }
        return war;
      }),
  );
  // Final active wars
  activeWars = activeWars.filter((war) => {
    if (villageId) {
      return (
        war.attackerVillageId === villageId ||
        war.defenderVillageId === villageId ||
        war.warAllies.find((f) => f.villageId === villageId)
      );
    }
    return war.status === "ACTIVE";
  });
  // Reset wartime townhalls if we're fetching all of them
  if (!villageId) {
    await resetStructuresWhenNotInWar(activeWars);
  }

  // Return active wars
  return activeWars;
};

export type FetchActiveWarsReturnType = War & {
  warAllies: (WarAlly & { village: Village })[];
  attackerVillage: Village & { structures: VillageStructure[] };
  defenderVillage: Village & { structures: VillageStructure[] };
};

/**
 * Fetch an active war
 * @param client - The database client
 * @param warId - The ID of the war
 * @returns The war
 */
export const fetchActiveWar = async (client: DrizzleClient, warId: string) => {
  return await client.query.war.findFirst({
    where: and(eq(war.id, warId), eq(war.status, "ACTIVE")),
    with: {
      attackerVillage: {
        with: { structures: true },
      },
      defenderVillage: {
        with: { structures: true },
      },
      warAllies: {
        with: {
          village: true,
        },
      },
    },
  });
};

/**
 * Fetch ended wars for a village
 * @param client - The database client
 * @param villageId - The ID of the village
 * @returns The ended wars
 */
export const fetchEndedWars = async (client: DrizzleClient, villageId?: string) => {
  const endedWars = await client.query.war.findMany({
    where: ne(war.status, "ACTIVE"),
    with: {
      attackerVillage: {
        with: { structures: true },
      },
      defenderVillage: {
        with: { structures: true },
      },
      warAllies: {
        with: {
          village: true,
        },
      },
    },
    orderBy: [desc(war.endedAt)],
  });
  return endedWars.filter((war) => {
    if (villageId) {
      return (
        war.attackerVillageId === villageId ||
        war.defenderVillageId === villageId ||
        war.warAllies.find((f) => f.villageId === villageId)
      );
    }
    return true;
  });
};

export type GetActiveWarsReturnType = NonNullable<
  RouterOutputs["war"]["getActiveWars"]
>;
