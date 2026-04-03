import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { RouterOutputs } from "@/app/_trpc/client";
import {
  ELDER_MIN_VOTING_COUNT,
  ELDER_WAR_VOTE_HOURS,
  IMG_AVATAR_DEFAULT,
  MAP_RESERVED_SECTORS,
  SHRINE_MAX_PER_VILLAGE,
  VILLAGE_SYNDICATE_ID,
  WAR_ALLY_MAX_PAYMENT_PERCENTAGE,
  WAR_DECLARATION_COOLDOWN_HOURS,
  WAR_DECLARATION_COST,
  WAR_FACTION_MAX_SECTORS,
  WAR_LOSING_COOLDOWN_DAYS,
  WAR_MINIMUM_MEMBERS_REQUIRED,
  WAR_MINIMUM_TOKENS_FOR_BEING_ATTACKABLE,
  WAR_PURCHASE_SHRINE_TOKEN_COST,
  WAR_RAID_SHRINE_HP,
  WAR_VILLAGE_MAX_SECTORS,
} from "@/drizzle/constants";
import type { Village, VillageStructure, War, WarAlly } from "@/drizzle/schema";
import {
  actionLog,
  notification,
  quest,
  sector,
  userData,
  village,
  villageElderVote,
  war,
  warAlly,
  warKill,
} from "@/drizzle/schema";
import { castElderVoteEntry, fetchElderVote, fetchElderVotes } from "@/libs/elder";
import { findActiveExclusiveRaidForSector } from "@/libs/raids";
import {
  canJoinWar,
  getShrineHpByLevel,
  handleWarEnd,
  isVillageInvolvedInAnyWar,
} from "@/libs/war";
import { fetchUpdatedUser, fetchUser } from "@/routers/profile";
import {
  fetchRequest,
  fetchRequests,
  insertRequest,
  updateRequestState,
} from "@/routers/sparring";
import {
  countVillageSectors,
  fetchAlliances,
  fetchSector,
  fetchStructures,
  fetchVillage,
  fetchVillages,
} from "@/routers/village";
import type { DrizzleClient } from "@/server/db";

import { findRelationship } from "@/utils/alliance";
import { isKage } from "@/utils/kage";
import { canAdministrateWars, canSeeSecretData } from "@/utils/permissions";
import { DAY_S, secondsFromDate, secondsFromNow } from "@/utils/time";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "../trpc";

export const warRouter = createTRPCRouter({
  // Get active wars for a village
  getActiveWars: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Get active wars for a village" },
    })
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await fetchActiveWars(ctx.drizzle, input.villageId);
    }),

  // Get ended wars for a village
  getEndedWars: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Get ended wars for a village" },
    })
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
    .meta({
      mcp: { enabled: true, description: "Build a shrine to claim a sector" },
    })
    .input(z.object({ warId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, activeWar, exclusiveRaids] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchActiveWar(ctx.drizzle, input.warId),
        // Fetch all exclusive raids (filter by sector after we know the war's sector)
        ctx.drizzle.query.quest.findMany({
          where: and(eq(quest.questType, "raid"), eq(quest.hidden, false)),
        }),
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
      if (activeWar.defenderShrineHp > 0) {
        return errorResponse("Shrine is still standing");
      }
      if (MAP_RESERVED_SECTORS.includes(activeWar.sector)) {
        return errorResponse("Shrine cannot be built on reserved sectors");
      }

      // Check if there's an active exclusive raid for this sector that must be completed first
      const activeExclusiveRaid = findActiveExclusiveRaidForSector(
        exclusiveRaids,
        activeWar.sector,
      );

      if (activeExclusiveRaid) {
        return errorResponse(
          "You must defeat the raid boss before claiming this sector! Check the shrine page to join the raid.",
        );
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
    .meta({
      mcp: {
        enabled: true,
        description: "Declare a sector war on a map sector",
      },
    })
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

      // Check minimum member count for war participation (after we know village IDs)
      const [attackerMemberCount, actualDefenderCount] = await Promise.all([
        attackerVillage ? getVillageMemberCount(ctx.drizzle, attackerVillage.id) : 0,
        defenderVillage ? getVillageMemberCount(ctx.drizzle, defenderVillage.id) : 0,
      ]);
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
        return errorResponse(
          `Your village needs ${WAR_DECLARATION_COST.toLocaleString()} tokens to declare war`,
        );
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
        isVillageInvolvedInAnyWar(activeWars, user?.village?.id, undefined, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ])
      ) {
        return errorResponse("Your village is already involved in an active war");
      }

      // Check if target village is already involved in any active war
      if (
        isVillageInvolvedInAnyWar(activeWars, defenderVillageId, undefined, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ])
      ) {
        return errorResponse("Target village is already involved in an active war");
      }

      // Check minimum member count for war participation
      if (attackerVillage && attackerMemberCount < WAR_MINIMUM_MEMBERS_REQUIRED) {
        return errorResponse(
          `Your village needs at least ${WAR_MINIMUM_MEMBERS_REQUIRED} members to declare sector war`,
        );
      }
      if (defenderVillage && actualDefenderCount < WAR_MINIMUM_MEMBERS_REQUIRED) {
        return errorResponse(
          `Target village needs at least ${WAR_MINIMUM_MEMBERS_REQUIRED} members to be attacked`,
        );
      }

      // Re-check just before creation to avoid races
      if (
        isVillageInvolvedInAnyWar(activeWars, attackerVillage.id, undefined, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ]) ||
        isVillageInvolvedInAnyWar(activeWars, defenderVillageId, undefined, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ])
      ) {
        return errorResponse("A village is now already involved in an active war");
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
          // Sector wars only have a defender shrine (the sector's shrine)
          attackerShrineHp: 0,
          attackerShrineMaxHp: 0,
          attackerShrineStatus: "CAPTURED",
          defenderShrineHp: getShrineHpByLevel(targetSector?.shrineLevel),
          defenderShrineMaxHp: getShrineHpByLevel(targetSector?.shrineLevel),
          defenderShrineStatus: "ACTIVE",
        }),
        ctx.drizzle.insert(notification).values({
          userId: user.userId,
          content: `${attackerVillage?.name} has declared a sector war in sector ${input.sectorId}`,
        }),
        ctx.drizzle
          .update(userData)
          .set({ unreadNotifications: sql`unreadNotifications + 1` })
          .where(
            inArray(
              userData.villageId,
              [user.villageId, defenderVillageId].filter((v) => v),
            ),
          ),
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
    .meta({
      mcp: { enabled: true, description: "Declare village war or raid" },
    })
    .input(
      z.object({
        targetVillageId: z.string(),
        targetStructureRoute: z.string(),
        userVillageId: z.string(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Single pre-fetch round: user, war state, village data, and elder/cooldown checks all in parallel
      const [
        { user },
        activeWars,
        villages,
        relationships,
        structures,
        attackerMemberCount,
        defenderMemberCount,
        recentRejection,
        existingPending,
        elders,
      ] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchActiveWars(ctx.drizzle),
        fetchVillages(ctx.drizzle),
        fetchAlliances(ctx.drizzle),
        fetchStructures(ctx.drizzle, input.targetVillageId),
        getVillageMemberCount(ctx.drizzle, input.userVillageId),
        getVillageMemberCount(ctx.drizzle, input.targetVillageId),
        ctx.drizzle.query.villageElderVote.findFirst({
          columns: { endsAt: true },
          where: and(
            eq(villageElderVote.villageId, input.userVillageId),
            eq(villageElderVote.type, "WAR_DECLARATION"),
            eq(villageElderVote.status, "REJECTED"),
            gte(
              villageElderVote.endsAt,
              secondsFromNow(-WAR_DECLARATION_COOLDOWN_HOURS * 3600),
            ),
          ),
          orderBy: desc(villageElderVote.endsAt),
        }),
        ctx.drizzle.query.villageElderVote.findFirst({
          columns: { id: true },
          where: and(
            eq(villageElderVote.villageId, input.userVillageId),
            eq(villageElderVote.type, "WAR_DECLARATION"),
            eq(villageElderVote.status, "PENDING"),
          ),
        }),
        ctx.drizzle.query.userData.findMany({
          columns: { userId: true },
          where: and(
            eq(userData.villageId, input.userVillageId),
            eq(userData.rank, "ELDER"),
            eq(userData.isAi, false),
          ),
        }),
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
      // Exclude the kage (war initiator) from the elder count
      const eligibleElders = elders.filter((e) => e.userId !== user?.userId);

      // Guard
      if (!user?.village) {
        return errorResponse("You must be in a village to declare war");
      }
      if (!user?.villageId) {
        return errorResponse("You must be in a village to declare war");
      }
      if (user.villageId !== input.userVillageId) {
        return errorResponse("Village mismatch — please refresh and try again");
      }
      if (!structure) {
        return errorResponse("Structure not found");
      }
      if (user.userId !== user.village.kageId) {
        return errorResponse("Only the leader can declare war");
      }
      if (recentRejection) {
        const cooldownEnd = new Date(
          recentRejection.endsAt.getTime() +
            WAR_DECLARATION_COOLDOWN_HOURS * 3600 * 1000,
        );
        return errorResponse(
          `War declaration is on cooldown after a recent rejection or cancellation. Available again at ${cooldownEnd.toUTCString()}.`,
        );
      }
      if (existingPending) {
        return errorResponse("Your village already has a pending war declaration vote");
      }

      if (user.village.tokens < WAR_DECLARATION_COST) {
        return errorResponse(
          `Your village needs ${WAR_DECLARATION_COST.toLocaleString()} tokens to declare war`,
        );
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
        isVillageInvolvedInAnyWar(activeWars, user?.village?.id, undefined, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ])
      ) {
        return errorResponse("Your village is already involved in an active war");
      }

      // Check if target village is already involved in any active war
      if (
        isVillageInvolvedInAnyWar(activeWars, input.targetVillageId, undefined, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ])
      ) {
        return errorResponse("Target village is already involved in an active war");
      }

      // Check minimum member count for war participation
      if (attackerMemberCount < WAR_MINIMUM_MEMBERS_REQUIRED) {
        return errorResponse(
          `Your village needs at least ${WAR_MINIMUM_MEMBERS_REQUIRED} members to declare war`,
        );
      }
      if (defenderMemberCount < WAR_MINIMUM_MEMBERS_REQUIRED) {
        return errorResponse(
          `Target village needs at least ${WAR_MINIMUM_MEMBERS_REQUIRED} members to be attacked`,
        );
      }

      // Re-check just before creation to avoid races
      if (
        isVillageInvolvedInAnyWar(activeWars, attackerVillage.id, undefined, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ]) ||
        isVillageInvolvedInAnyWar(activeWars, defenderVillage.id, undefined, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ])
      ) {
        return errorResponse("A village is now already involved in an active war");
      }

      // Require minimum elder count to proceed with war declaration
      if (eligibleElders.length < ELDER_MIN_VOTING_COUNT)
        return errorResponse(
          `At least ${ELDER_MIN_VOTING_COUNT} elders must be in position before war can be declared`,
        );

      // Insert vote — existingPending guard above prevents concurrent dupes
      const voteId = nanoid();
      const endsAt = secondsFromNow(ELDER_WAR_VOTE_HOURS * 3600);
      await ctx.drizzle.insert(villageElderVote).values({
        id: voteId,
        villageId: user.villageId,
        type: "WAR_DECLARATION",
        initiatedByUserId: user.userId,
        targetId: input.targetVillageId,
        warType: warType,
        targetStructureRoute: structure.route,
        status: "PENDING",
        endsAt,
      });
      const elderContent = `${user.username} has submitted a war declaration against ${defenderVillage.name}. You have ${ELDER_WAR_VOTE_HOURS} hours to vote.`;
      const kageContent = `Your war declaration against ${defenderVillage.name} has been submitted. Elders have ${ELDER_WAR_VOTE_HOURS} hours to vote.`;
      const elderUserIds = eligibleElders.map((e) => e.userId);
      const allNotifyIds = [user.userId, ...elderUserIds];
      await Promise.all([
        ctx.drizzle.insert(notification).values([
          { userId: user.userId, content: kageContent },
          ...elderUserIds.map((userId) => ({
            userId,
            content: elderContent,
          })),
        ]),
        ctx.drizzle
          .update(userData)
          .set({ unreadNotifications: sql`unreadNotifications + 1` })
          .where(inArray(userData.userId, allNotifyIds)),
      ]);
      return {
        success: true,
        message: `War declaration submitted. Elders have ${ELDER_WAR_VOTE_HOURS} hours to vote.`,
      };
    }),

  // Create an offer for factions to join the war
  createAllyOffer: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Create ally offer for war support" },
    })
    .input(
      z.object({
        warId: z.string(),
        tokenOffer: z.int().min(1000),
        targetVillageId: z.string(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, activeWar, villages, relationships, allActiveWars] =
        await Promise.all([
          fetchUpdatedUser({
            client: ctx.drizzle,
            userId: ctx.userId,
          }),
          fetchActiveWar(ctx.drizzle, input.warId),
          fetchVillages(ctx.drizzle),
          fetchAlliances(ctx.drizzle),
          fetchActiveWars(ctx.drizzle),
        ]);
      // Derived
      const targetVillage = villages.find((v) => v.id === input.targetVillageId);

      // Check minimum member count for war participation (after we know village IDs)
      const [userVillageMemberCount, targetVillageMemberCount] = await Promise.all([
        user?.villageId ? getVillageMemberCount(ctx.drizzle, user.villageId) : 0,
        targetVillage ? getVillageMemberCount(ctx.drizzle, targetVillage.id) : 0,
      ]);
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
      if (!["VILLAGE_WAR", "WAR_RAID"].includes(activeWar.type)) {
        return errorResponse(
          "War ally offers only available for village wars and raids",
        );
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

      // Check if payment exceeds max percentage of village tokens
      const maxPayment = Math.floor(
        user.village.tokens * WAR_ALLY_MAX_PAYMENT_PERCENTAGE,
      );
      const maxPercentage = WAR_ALLY_MAX_PAYMENT_PERCENTAGE * 100;
      if (input.tokenOffer > maxPayment) {
        return errorResponse(
          `Payment cannot exceed ${maxPercentage}% of village tokens (max: ${maxPayment.toLocaleString()})`,
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
      if (
        isVillageInvolvedInAnyWar(allActiveWars, input.targetVillageId, activeWar.id, [
          "VILLAGE_WAR",
          "WAR_RAID",
        ])
      ) {
        return errorResponse(
          "Target village is already involved in another active war",
        );
      }

      if (userVillageMemberCount < WAR_MINIMUM_MEMBERS_REQUIRED) {
        return errorResponse(
          `Your village needs at least ${WAR_MINIMUM_MEMBERS_REQUIRED} members to create ally offers`,
        );
      }
      if (targetVillageMemberCount < WAR_MINIMUM_MEMBERS_REQUIRED) {
        return errorResponse(
          `Target village needs at least ${WAR_MINIMUM_MEMBERS_REQUIRED} members to be invited to war`,
        );
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
    .meta({ mcp: { enabled: true, description: "Reject a war ally offer" } })
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
  getAllyOffers: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Get pending war ally offers" },
    })
    .query(async ({ ctx }) => {
      return await fetchRequests(ctx.drizzle, ["WAR_ALLY"], 3600 * 12, ctx.userId);
    }),

  // Delist a faction offer
  cancelAllyOffer: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Cancel a war ally offer" } })
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
    .meta({ mcp: { enabled: true, description: "Accept a war ally offer" } })
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
      if (!["VILLAGE_WAR", "WAR_RAID"].includes(activeWar.type)) {
        return errorResponse(
          "War ally offers only available for village wars and raids",
        );
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
    .meta({ mcp: { enabled: true, description: "Surrender a war" } })
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
        const warExhaustionEnd = secondsFromDate(
          WAR_LOSING_COOLDOWN_DAYS * DAY_S,
          endedAt,
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
    .meta({ mcp: { enabled: true, description: "Get war kill records" } })
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
    .meta({
      mcp: { enabled: true, description: "Get aggregated war kill statistics" },
    })
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

      // Other aggregate fields - only sum positive values (actual damage contribution)
      // Negative values represent losses, which shouldn't count as "damage dealt"
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
          count: sql<number>`sum(GREATEST(${aggregateField}, 0))`,
        })
        .from(warKill)
        .leftJoin(userData, eq(warKill.killerId, userData.userId))
        .leftJoin(village, eq(userData.villageId, village.id))
        .where(eq(warKill.warId, input.warId))
        .groupBy(warKill.killerId)
        .orderBy(desc(sql<number>`sum(GREATEST(${aggregateField}, 0))`));
    }),

  // Get pending elder votes for a village
  getElderVotes: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Get pending elder votes for a village",
      },
    })
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [user, votes] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchElderVotes(ctx.drizzle, input.villageId),
      ]);
      if (user.villageId !== input.villageId && !canSeeSecretData(user.role)) {
        throw serverError("FORBIDDEN", "You can only view votes for your own village");
      }
      return votes;
    }),

  // Kage cancels a pending war declaration before elders vote
  cancelWarDeclaration: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Cancel a pending war declaration vote (Kage only)",
      },
    })
    .input(z.object({ voteId: z.string(), userVillageId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [{ user }, voteRecord, elders] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchElderVote(ctx.drizzle, input.voteId),
        ctx.drizzle
          .select({ userId: userData.userId })
          .from(userData)
          .where(
            and(
              eq(userData.villageId, input.userVillageId),
              eq(userData.rank, "ELDER"),
            ),
          ),
      ]);

      // Guards
      if (!user?.villageId) return errorResponse("You must be in a village");
      if (user.villageId !== input.userVillageId)
        return errorResponse("Village mismatch — please refresh and try again");
      if (!user.village) return errorResponse("Village not found");
      if (user.village.kageId !== user.userId)
        return errorResponse("Only the Kage can cancel a war declaration");
      if (!voteRecord) return errorResponse("War declaration not found");
      if (voteRecord.villageId !== user.villageId)
        return errorResponse("This vote does not belong to your village");
      if (voteRecord.type !== "WAR_DECLARATION")
        return errorResponse("Can only cancel war declarations");
      if (voteRecord.status !== "PENDING")
        return errorResponse("Can only cancel a pending war declaration");
      if (new Date(voteRecord.endsAt).getTime() <= Date.now())
        return errorResponse("Voting window has ended; cannot cancel");

      // Atomically cancel — guard ensures it's still PENDING.
      // Set endsAt = now so the cooldown window starts from the actual resolution time,
      // not the original scheduled deadline (which would be in the future).
      const updateRes = await ctx.drizzle
        .update(villageElderVote)
        .set({ status: "REJECTED", endsAt: new Date() })
        .where(
          and(
            eq(villageElderVote.id, input.voteId),
            eq(villageElderVote.status, "PENDING"),
          ),
        );

      if (updateRes.rowsAffected === 0)
        return errorResponse(
          "War declaration could not be cancelled — it may have already been resolved",
        );

      if (elders.length > 0) {
        const notifyIds = elders.map((e) => e.userId);
        await Promise.all([
          ctx.drizzle.insert(notification).values(
            notifyIds.map((userId) => ({
              userId,
              content: `${user.username} has cancelled the war declaration. No war will be started.`,
            })),
          ),
          ctx.drizzle
            .update(userData)
            .set({ unreadNotifications: sql`unreadNotifications + 1` })
            .where(inArray(userData.userId, notifyIds)),
        ]);
      }

      return {
        success: true,
        message: "War declaration cancelled. No tokens were charged.",
      };
    }),

  // Elder votes on a pending war declaration
  voteOnWarDeclaration: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Vote on a pending war declaration as elder",
      },
    })
    .input(
      z.object({
        voteId: z.string(),
        vote: z.enum(["YES", "NO"]),
        userVillageId: z.string(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [{ user }, voteRecord, attackerVillage, elderCount] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchElderVote(ctx.drizzle, input.voteId),
        fetchVillage(ctx.drizzle, input.userVillageId),
        ctx.drizzle
          .select({ count: sql<number>`count(*)` })
          .from(userData)
          .where(
            and(
              eq(userData.villageId, input.userVillageId),
              eq(userData.rank, "ELDER"),
              eq(userData.isAi, false),
            ),
          )
          .then(([r]) => r?.count ?? 0),
      ]);

      // Guards
      if (!user) return errorResponse("User not found");
      if (!user.villageId) return errorResponse("You must be in a village");
      if (user.villageId !== input.userVillageId)
        return errorResponse("Village mismatch — please refresh and try again");
      if (user.rank !== "ELDER") return errorResponse("Only elders can vote");
      if (!voteRecord) return errorResponse("Vote not found");
      if (voteRecord.status !== "PENDING")
        return errorResponse("Vote is no longer pending");
      if (voteRecord.villageId !== user.villageId)
        return errorResponse("Vote is not for your village");
      if (voteRecord.type !== "WAR_DECLARATION")
        return errorResponse("Not a war declaration vote");
      if (user.userId === voteRecord.initiatedByUserId)
        return errorResponse(
          "The war declaration initiator cannot vote on their own motion",
        );
      if (new Date() > voteRecord.endsAt)
        return errorResponse("Voting period has ended");

      if (elderCount < ELDER_MIN_VOTING_COUNT) {
        return errorResponse(
          `At least ${ELDER_MIN_VOTING_COUNT} elders must be in position to vote`,
        );
      }

      // Insert the vote entry, re-fetch fresh entries, and resolve outcome
      const voteResult = await castElderVoteEntry(
        ctx.drizzle,
        input.voteId,
        user.userId,
        input.vote,
        elderCount,
      );
      if (!voteResult) return errorResponse("You have already voted");
      const { outcome, freshEntries } = voteResult;
      if (outcome === "APPROVED") {
        // Atomically claim the motion and pre-fetch needed data in parallel
        const [claimResult, defenderVillage, currentActiveWars] = await Promise.all([
          ctx.drizzle
            .update(villageElderVote)
            .set({ status: "APPROVED" })
            .where(
              and(
                eq(villageElderVote.id, input.voteId),
                eq(villageElderVote.status, "PENDING"),
              ),
            ),
          ctx.drizzle.query.village.findFirst({
            columns: { name: true, kageId: true },
            where: eq(village.id, voteRecord.targetId),
          }),
          fetchActiveWars(ctx.drizzle),
        ]);
        if (claimResult.rowsAffected === 0) {
          return errorResponse("Vote already processed");
        }

        // Re-check war involvement — a village may have entered a war during the voting window
        if (
          isVillageInvolvedInAnyWar(
            currentActiveWars,
            voteRecord.villageId,
            undefined,
            ["VILLAGE_WAR", "WAR_RAID"],
          ) ||
          isVillageInvolvedInAnyWar(currentActiveWars, voteRecord.targetId, undefined, [
            "VILLAGE_WAR",
            "WAR_RAID",
          ])
        ) {
          await Promise.all([
            ctx.drizzle
              .update(villageElderVote)
              .set({ status: "REJECTED", endsAt: new Date() })
              .where(eq(villageElderVote.id, input.voteId)),
            ctx.drizzle.insert(notification).values({
              userId: voteRecord.initiatedByUserId,
              content: `War declaration against ${defenderVillage?.name ?? "another village"} was cancelled — a village is already involved in an active war.`,
            }),
            ctx.drizzle
              .update(userData)
              .set({ unreadNotifications: sql`unreadNotifications + 1` })
              .where(eq(userData.userId, voteRecord.initiatedByUserId)),
          ]);
          return errorResponse("A village is already involved in an active war");
        }

        // Start the war and deduct tokens
        if (!attackerVillage || attackerVillage.tokens < WAR_DECLARATION_COST) {
          await Promise.all([
            ctx.drizzle
              .update(villageElderVote)
              .set({ status: "REJECTED", endsAt: new Date() })
              .where(eq(villageElderVote.id, input.voteId)),
            ctx.drizzle.insert(notification).values({
              userId: voteRecord.initiatedByUserId,
              content: `War declaration against ${defenderVillage?.name ?? "another village"} was cancelled — village no longer has enough tokens.`,
            }),
            ctx.drizzle
              .update(userData)
              .set({ unreadNotifications: sql`unreadNotifications + 1` })
              .where(eq(userData.userId, voteRecord.initiatedByUserId)),
          ]);
          return errorResponse("Village no longer has enough tokens to declare war");
        }
        // Deduct tokens with DB guard — if this fails, war is never inserted
        const tokenResult = await ctx.drizzle
          .update(village)
          .set({ tokens: sql`${village.tokens} - ${WAR_DECLARATION_COST}` })
          .where(
            and(
              eq(village.id, voteRecord.villageId),
              gte(village.tokens, WAR_DECLARATION_COST),
            ),
          );
        if (tokenResult.rowsAffected === 0) {
          await Promise.all([
            ctx.drizzle
              .update(villageElderVote)
              .set({ status: "REJECTED", endsAt: new Date() })
              .where(eq(villageElderVote.id, input.voteId)),
            ctx.drizzle.insert(notification).values({
              userId: voteRecord.initiatedByUserId,
              content: `War declaration against ${defenderVillage?.name ?? "another village"} was cancelled — the village no longer has enough tokens.`,
            }),
            ctx.drizzle
              .update(userData)
              .set({ unreadNotifications: sql`unreadNotifications + 1` })
              .where(eq(userData.userId, voteRecord.initiatedByUserId)),
          ]);
          return errorResponse("Village no longer has enough tokens to declare war");
        }
        const warId = nanoid();
        const warContent = `${attackerVillage.name} has declared war on ${defenderVillage?.name ?? "another village"}!`;
        const notifyKageIds = [voteRecord.initiatedByUserId];
        if (defenderVillage?.kageId) notifyKageIds.push(defenderVillage.kageId);
        await Promise.all([
          ctx.drizzle.insert(war).values({
            id: warId,
            attackerVillageId: voteRecord.villageId,
            defenderVillageId: voteRecord.targetId,
            status: "ACTIVE",
            type: voteRecord.warType ?? "VILLAGE_WAR",
            targetStructureRoute: voteRecord.targetStructureRoute ?? "/townhall",
            attackerShrineHp: WAR_RAID_SHRINE_HP,
            attackerShrineMaxHp: WAR_RAID_SHRINE_HP,
            attackerShrineStatus: "ACTIVE",
            defenderShrineHp: WAR_RAID_SHRINE_HP,
            defenderShrineMaxHp: WAR_RAID_SHRINE_HP,
            defenderShrineStatus: "ACTIVE",
          }),
          ctx.drizzle
            .insert(notification)
            .values(notifyKageIds.map((userId) => ({ userId, content: warContent }))),
          ctx.drizzle
            .update(userData)
            .set({ unreadNotifications: sql`unreadNotifications + 1` })
            .where(inArray(userData.userId, notifyKageIds)),
        ]);
        return {
          success: true,
          message: "War declaration approved. War has started!",
        };
      }

      if (outcome === "REJECTED") {
        // Atomically claim the rejection to prevent double notifications on concurrent votes.
        // Set endsAt = now so the cooldown window starts from the real resolution time.
        const [claimResult, targetVillage] = await Promise.all([
          ctx.drizzle
            .update(villageElderVote)
            .set({ status: "REJECTED", endsAt: new Date() })
            .where(
              and(
                eq(villageElderVote.id, input.voteId),
                eq(villageElderVote.status, "PENDING"),
              ),
            ),
          ctx.drizzle.query.village.findFirst({
            columns: { name: true },
            where: eq(village.id, voteRecord.targetId),
          }),
        ]);
        if (claimResult.rowsAffected === 0) {
          return {
            success: true,
            message: "War declaration vote already resolved",
          };
        }
        await Promise.all([
          ctx.drizzle.insert(notification).values({
            userId: voteRecord.initiatedByUserId,
            content: `War declaration against ${targetVillage?.name ?? "another village"} was rejected by the elders.`,
          }),
          ctx.drizzle
            .update(userData)
            .set({ unreadNotifications: sql`unreadNotifications + 1` })
            .where(eq(userData.userId, voteRecord.initiatedByUserId)),
        ]);
        return {
          success: true,
          message: "War declaration rejected by the elders",
        };
      }

      return {
        success: true,
        message: `Vote recorded. Current tally: ${freshEntries.filter((e) => e.vote === "YES").length} YES, ${freshEntries.filter((e) => e.vote === "NO").length} NO`,
      };
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
        // For village wars and raids, check war health instead of townhall
        if (["VILLAGE_WAR", "WAR_RAID"].includes(war.type)) {
          // Set tokens to 0 when war health reaches 0 to trigger war end
          if (war.attackerWarHealth <= 0) {
            war.attackerVillage.tokens = 0;
          }
          if (war.defenderWarHealth <= 0) {
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
      return isVillageInvolvedInAnyWar([war], villageId);
    }
    return war.status === "ACTIVE";
  });

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
      return isVillageInvolvedInAnyWar([war], villageId);
    }
    return true;
  });
};

export type GetActiveWarsReturnType = NonNullable<
  RouterOutputs["war"]["getActiveWars"]
>;

/**
 * Get the member count for a village
 * @param client - The DrizzleClient instance
 * @param villageId - The ID of the village
 * @returns The number of members in the village
 */
const getVillageMemberCount = async (
  client: DrizzleClient,
  villageId: string,
): Promise<number> => {
  const result = await client
    .select({ count: sql<number>`count(*)` })
    .from(userData)
    .where(eq(userData.villageId, villageId));
  return result[0]?.count || 0;
};

// Elder vote utilities live in @/libs/elder — re-exported here for backward compatibility
export {
  castElderVoteEntry,
  fetchElderVote,
  fetchElderVotes,
  fetchExpiredElderVotes,
  resolveElderVote,
} from "@/libs/elder";
