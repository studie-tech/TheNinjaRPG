import { and, asc, desc, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  MAP_RESERVED_SECTORS,
  SHRINE_AI_UNLOCK_COST,
  SHRINE_BATTLE_LOBBY_SECONDS,
  SHRINE_BATTLE_MAX_USERS_PER_SIDE,
  SHRINE_BATTLE_MIN_ATTACKERS,
  SHRINE_BOOST_COST,
  SHRINE_BOOST_DURATION_HOURS,
  SHRINE_BOOST_TYPES,
  SHRINE_MAX_AI_ASSIGNMENTS,
  SHRINE_MAX_LEVEL,
  SHRINE_UPGRADE_COST,
  SHRINE_WEEKLY_MAINTENANCE_COST,
  shrineLobbyFreshAfter,
  VILLAGE_SYNDICATE_ID,
  WAR_SHRINE_MAINTENANCE_DAYS,
} from "@/drizzle/constants";
import {
  mpvpBattleQueue,
  mpvpBattleUser,
  sector,
  userData,
  village,
} from "@/drizzle/schema";
import { getServerPusher } from "@/libs/pusher";
import { initiateBattle } from "@/routers/combat";
import { fetchUpdatedUser, fetchUser } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { isMysqlDuplicateKeyError } from "@/server/utils/mysqlErrors";
import {
  boostInactivePredicate,
  setActiveBoostExpression,
  setShrineSettingsKeyExpression,
} from "@/server/utils/shrine";
import { findRelationship } from "@/utils/alliance";
import { canSeeSecretData } from "@/utils/permissions";
import { secondsFromDate } from "@/utils/time";
import { getBoostTemplateSchema, setBoostTemplateSchema } from "@/validators/shrine";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "../trpc";
import { fetchActiveUserMpvpBattles } from "./clan";
import { fetchAlliances } from "./village";
import { fetchActiveWars } from "./war";

// Pusher instance
const pusher = getServerPusher();

export const shrineRouter = createTRPCRouter({
  // Get all AI names
  getShrineAis: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get all shrine AI defenders" } })
    .query(async ({ ctx }) => {
      return await ctx.drizzle.query.userData.findMany({
        where: and(eq(userData.isAi, true), eq(userData.inShrines, true)),
        with: {
          jutsus: {
            columns: {
              level: true,
            },
            with: {
              jutsu: {
                columns: {
                  name: true,
                },
              },
            },
          },
        },
        columns: {
          userId: true,
          username: true,
          level: true,
          rank: true,
          avatar: true,
        },
        orderBy: asc(userData.level),
      });
    }),

  // Get the captured sectors for a village
  getCapturedSectors: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get captured sectors for a village" } })
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sectors = await ctx.drizzle.query.sector.findMany({
        where: eq(sector.villageId, input.villageId),
      });
      return sectors;
    }),

  // Upgrade a shrine level
  upgradeShrine: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Upgrade a shrine level (Kage only)" } })
    .input(z.object({ sectorNumber: z.number() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [{ user }, targetSector] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle.query.sector.findFirst({
          where: eq(sector.sector, input.sectorNumber),
        }),
      ]);

      // Guards
      if (!user?.villageId) return errorResponse("You must be in a village");
      if (!targetSector) return errorResponse("Sector not found");
      if (targetSector.villageId !== user.villageId) {
        return errorResponse("You can only upgrade your own shrines");
      }
      if (targetSector.shrineLevel >= SHRINE_MAX_LEVEL) {
        return errorResponse(`Shrine level cannot exceed ${SHRINE_MAX_LEVEL}`);
      }
      if (user?.village?.kageId !== user.userId) {
        return errorResponse("Only the Kage can upgrade shrines");
      }
      if (!user.village) return errorResponse("Village not found");
      if (user.village.tokens < SHRINE_UPGRADE_COST) {
        return errorResponse(
          `Need ${SHRINE_UPGRADE_COST.toLocaleString()} tokens to upgrade shrine`,
        );
      }

      // IMPORTANT: do token update with DB-guard + atomic decrement
      // We do tokens first; if it fails, we do nothing else.
      const tokenRes = await ctx.drizzle
        .update(village)
        .set({ tokens: sql`${village.tokens} - ${SHRINE_UPGRADE_COST}` })
        .where(
          and(eq(village.id, user.villageId), gte(village.tokens, SHRINE_UPGRADE_COST)),
        );

      if (tokenRes.rowsAffected === 0) {
        return errorResponse("Not enough village tokens to upgrade shrine");
      }

      // Then upgrade shrine level with DB-guard to prevent concurrent upgrades
      const shrineUpdateRes = await ctx.drizzle
        .update(sector)
        .set({ shrineLevel: targetSector.shrineLevel + 1 })
        .where(
          and(
            eq(sector.sector, input.sectorNumber),
            eq(sector.shrineLevel, targetSector.shrineLevel),
          ),
        );

      if (shrineUpdateRes.rowsAffected === 0) {
        // Refund tokens since the guarded update failed
        await ctx.drizzle
          .update(village)
          .set({ tokens: sql`${village.tokens} + ${SHRINE_UPGRADE_COST}` })
          .where(eq(village.id, user.villageId));
        return errorResponse(
          "Shrine upgrade failed - shrine may have been upgraded by another request",
        );
      }

      return {
        success: true,
        message: `Successfully upgraded shrine to level ${targetSector.shrineLevel + 1}!`,
      };
    }),

  // Activate village-wide boost (requires level 3 shrine)
  activateBoost: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Activate village-wide shrine boost" } })
    .input(z.object({ boostType: z.enum(SHRINE_BOOST_TYPES), villageId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, hasShrine] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        hasLevel3Shrine(ctx.drizzle, input.villageId),
      ]);

      // Guards
      if (!user?.villageId) return errorResponse("You must be in a village");
      if (user.villageId !== input.villageId) {
        return errorResponse("You can only activate boosts for your own village");
      }
      if (!user.village) return errorResponse("Village not found");
      if (user.village.kageId !== user.userId && user.rank !== "ELDER") {
        return errorResponse("Only the Kage or Elders can activate boosts");
      }
      if (!hasShrine) {
        return errorResponse("Need at least one Level 3 shrine to activate boosts");
      }
      if (user.village.tokens < SHRINE_BOOST_COST) {
        return errorResponse(
          `Need ${SHRINE_BOOST_COST.toLocaleString()} tokens to activate boosts`,
        );
      }

      // Check if boost is already active
      const now = new Date();
      const currentBoosts = user.village.shrineSettings.activeBoosts || {};
      const existingBoost = currentBoosts[input.boostType];
      if (existingBoost && new Date(existingBoost) > now) {
        return errorResponse(`${input.boostType} boost is already active`);
      }

      // Update active boosts — JSON_SET targets only the specific boost key to avoid
      // race conditions with concurrent cron writes to other boost keys.
      const boostExpiry = secondsFromDate(SHRINE_BOOST_DURATION_HOURS * 60 * 60, now);

      const updateRes = await ctx.drizzle
        .update(village)
        .set({
          tokens: sql`${village.tokens} - ${SHRINE_BOOST_COST}`,
          shrineSettings: setActiveBoostExpression(
            input.boostType,
            boostExpiry.toISOString(),
          ),
        })
        .where(
          and(
            eq(village.id, user.villageId),
            gte(village.tokens, SHRINE_BOOST_COST),
            boostInactivePredicate(input.boostType, now.toISOString()),
          ),
        );

      if (updateRes.rowsAffected === 0) {
        return errorResponse(
          "Could not activate boost — insufficient tokens or boost already active",
        );
      }

      return {
        success: true,
        message: `${input.boostType} boost activated for ${SHRINE_BOOST_DURATION_HOURS} hours!`,
      };
    }),

  // Unlock AI defender type for village (Kage only)
  unlockAiDefender: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Unlock an AI defender for village" } })
    .input(z.object({ aiId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [{ user }, ai] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchUser(ctx.drizzle, input.aiId),
      ]);

      if (!user) return errorResponse("User not found");
      if (!user.village || !user.villageId)
        return errorResponse("You must be in a village");
      if (user.village.kageId !== user.userId) {
        return errorResponse("Only the Kage can unlock AI defenders");
      }
      if (user.village.tokens < SHRINE_AI_UNLOCK_COST) {
        return errorResponse(
          `Need ${SHRINE_AI_UNLOCK_COST.toLocaleString()} tokens to unlock AI defender`,
        );
      }
      if (!ai) return errorResponse("AI not found");

      const currentUnlocks = user.village.shrineSettings.unlockedAiIds || [];
      if (currentUnlocks.includes(input.aiId)) {
        return errorResponse("AI defender already unlocked");
      }

      const updatedUnlocks = [...currentUnlocks, input.aiId];

      const updateRes = await ctx.drizzle
        .update(village)
        .set({
          tokens: sql`${village.tokens} - ${SHRINE_AI_UNLOCK_COST}`,
          shrineSettings: setShrineSettingsKeyExpression(
            "unlockedAiIds",
            updatedUnlocks,
          ),
        })
        .where(
          and(
            eq(village.id, user.villageId),
            gte(village.tokens, SHRINE_AI_UNLOCK_COST),
          ),
        );

      if (updateRes.rowsAffected === 0) {
        return errorResponse("Not enough village tokens to unlock AI defender");
      }

      return {
        success: true,
        message: `AI defender unlocked! Cost: ${SHRINE_AI_UNLOCK_COST.toLocaleString()} tokens`,
      };
    }),

  // Toggle village-wide AI defender
  toggleVillageAiDefender: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Toggle AI defender active status" } })
    .input(z.object({ aiId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Queries
      const [{ user }, ai] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchUser(ctx.drizzle, input.aiId),
      ]);

      if (!user) return errorResponse("User not found");
      if (!user.village || !user.villageId)
        return errorResponse("You must be in a village");
      if (user.village.kageId !== user.userId) {
        return errorResponse("Only the Kage can manage AI defenders");
      }
      if (!ai) return errorResponse("AI not found");

      const currentUnlocks = user.village.shrineSettings.unlockedAiIds || [];
      const currentAssigns = user.village.shrineSettings.activeAiIds || [];

      if (!currentUnlocks.includes(input.aiId)) {
        return errorResponse("AI defender not unlocked");
      }

      let newAssigns: string[];
      let message: string;

      if (currentAssigns.includes(input.aiId)) {
        newAssigns = currentAssigns.filter((id) => id !== input.aiId);
        message = `AI defender ${ai.username} removed from active defenders`;
      } else {
        if (currentAssigns.length >= SHRINE_MAX_AI_ASSIGNMENTS) {
          return errorResponse(
            `Can only assign up to ${SHRINE_MAX_AI_ASSIGNMENTS} AI defenders`,
          );
        }
        newAssigns = [...currentAssigns, input.aiId];
        message = `AI defender ${ai.username} added to active defenders`;
      }

      await ctx.drizzle
        .update(village)
        .set({
          shrineSettings: setShrineSettingsKeyExpression("activeAiIds", newAssigns),
        })
        .where(eq(village.id, user.villageId));

      return { success: true, message };
    }),

  // Weekly maintenance payment per sector
  payWeeklyMaintenance: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Pay weekly shrine maintenance" } })
    .input(z.object({ sectorId: z.number() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [{ user }, targetSector] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle.query.sector.findFirst({
          where: eq(sector.id, input.sectorId),
          with: { village: true },
        }),
      ]);

      if (!user) return errorResponse("User not found");
      if (!user.village || !user.villageId)
        return errorResponse("You must be in a village");
      if (!targetSector) return errorResponse("Sector not found");
      if (targetSector.villageId !== user.villageId) {
        return errorResponse(
          "You can only pay maintenance for your own village's sectors",
        );
      }
      if (user.village.kageId !== user.userId) {
        return errorResponse("Only the Kage can pay shrine maintenance");
      }
      if (user.village.tokens < SHRINE_WEEKLY_MAINTENANCE_COST) {
        return errorResponse(
          `Need ${SHRINE_WEEKLY_MAINTENANCE_COST.toLocaleString()} tokens for maintenance`,
        );
      }

      const currentNextMaintainanceDueDate =
        targetSector.nextMaintainanceDueDate || new Date();

      const nextNextMaintainanceDueDate = secondsFromDate(
        WAR_SHRINE_MAINTENANCE_DAYS * 24 * 60 * 60,
        currentNextMaintainanceDueDate,
      );

      const tokenRes = await ctx.drizzle
        .update(village)
        .set({ tokens: sql`${village.tokens} - ${SHRINE_WEEKLY_MAINTENANCE_COST}` })
        .where(
          and(
            eq(village.id, user.villageId),
            gte(village.tokens, SHRINE_WEEKLY_MAINTENANCE_COST),
          ),
        );

      if (tokenRes.rowsAffected === 0) {
        return errorResponse("Not enough village tokens for maintenance");
      }

      // Update maintenance date with DB-guard to prevent concurrent modifications
      // Check against the actual database value (null or the date we read)
      const maintenanceUpdateRes = await ctx.drizzle
        .update(sector)
        .set({ nextMaintainanceDueDate: nextNextMaintainanceDueDate })
        .where(
          and(
            eq(sector.id, input.sectorId),
            targetSector.nextMaintainanceDueDate === null
              ? isNull(sector.nextMaintainanceDueDate)
              : eq(
                  sector.nextMaintainanceDueDate,
                  targetSector.nextMaintainanceDueDate,
                ),
          ),
        );

      if (maintenanceUpdateRes.rowsAffected === 0) {
        // Refund tokens since the guarded update failed
        await ctx.drizzle
          .update(village)
          .set({ tokens: sql`${village.tokens} + ${SHRINE_WEEKLY_MAINTENANCE_COST}` })
          .where(eq(village.id, user.villageId));
        return errorResponse(
          "Maintenance update failed - sector may have been modified by another request",
        );
      }

      return {
        success: true,
        message: `Weekly maintenance paid for sector ${targetSector.sector}: ${SHRINE_WEEKLY_MAINTENANCE_COST.toLocaleString()} tokens`,
      };
    }),

  // Get the boost template for a village
  getBoostTemplate: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get boost template for a village" } })
    .input(getBoostTemplateSchema)
    .query(async ({ ctx, input }) => {
      const [user, targetVillage] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.village.findFirst({
          where: eq(village.id, input.villageId),
          columns: { id: true, shrineSettings: true },
        }),
      ]);

      if (!user) {
        throw serverError("NOT_FOUND", "User not found");
      }
      if (!targetVillage) {
        throw serverError("NOT_FOUND", "Village not found");
      }

      if (user.villageId !== input.villageId && !canSeeSecretData(user.role)) {
        throw serverError(
          "FORBIDDEN",
          "You can only view boost templates for your own village",
        );
      }

      // shrineSettings is notNull with a default, but guard against legacy/null rows
      // the same way the cron tick does rather than dereferencing blindly.
      const shrineSettings = targetVillage.shrineSettings ?? null;
      return {
        boostTemplate: shrineSettings?.boostTemplate ?? [],
        boostTemplateUpdatedBy: shrineSettings?.boostTemplateUpdatedBy ?? null,
        boostTemplateUpdatedAt: shrineSettings?.boostTemplateUpdatedAt ?? null,
      };
    }),

  // Set the boost template for a village (Kage or Elder only)
  setBoostTemplate: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Set boost template for a village (Kage/Elder only)",
      },
    })
    .input(setBoostTemplateSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [{ user }, hasShrine] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        hasLevel3Shrine(ctx.drizzle, input.villageId),
      ]);

      // Guards
      if (!user?.villageId) return errorResponse("You must be in a village");
      if (user.villageId !== input.villageId) {
        return errorResponse("You can only set boost templates for your own village");
      }
      if (!user.village) return errorResponse("Village not found");
      if (user.village.kageId !== user.userId && user.rank !== "ELDER") {
        return errorResponse("Only the Kage or Elders can set boost templates");
      }
      if (!hasShrine) {
        return errorResponse(
          "Need at least one Level 3 shrine to set a boost template",
        );
      }

      await ctx.drizzle
        .update(village)
        .set({
          shrineSettings: sql`JSON_SET(
            COALESCE(${village.shrineSettings}, JSON_OBJECT()),
            '$.boostTemplate', CAST(${JSON.stringify(input.template)} AS JSON),
            '$.boostTemplateUpdatedBy', ${user.username},
            '$.boostTemplateUpdatedAt', ${new Date().toISOString()}
          )`,
        })
        .where(eq(village.id, input.villageId));

      return { success: true, message: "Boost template saved" };
    }),

  // ============================================
  // MPVP Shrine Battle Endpoints
  // ============================================

  // Get active shrine battles for a sector
  getShrineBattles: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Get active shrine battles for sector" },
    })
    .input(z.object({ sectorNumber: z.number() }))
    .query(async ({ ctx, input }) => {
      // Exclude lobbies past their natural lifetime so abandoned shrine
      // battles stop showing up in the lobby UI before the cron deletes them.
      const shrineLobbyStaleBefore = shrineLobbyFreshAfter();
      // Fetch all battles with FIFO ordering (oldest first)
      const battles = await ctx.drizzle.query.mpvpBattleQueue.findMany({
        where: and(
          eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
          eq(mpvpBattleQueue.sector, input.sectorNumber),
          isNull(mpvpBattleQueue.battleId),
          gt(mpvpBattleQueue.createdAt, shrineLobbyStaleBefore),
        ),
        with: {
          queue: {
            columns: {
              userId: true,
              side: true,
              slot: true,
              createdAt: true,
            },
            with: {
              user: {
                columns: {
                  username: true,
                  level: true,
                  rank: true,
                  avatar: true,
                  villageId: true,
                },
              },
            },
          },
        },
        orderBy: asc(mpvpBattleQueue.createdAt), // FIFO ordering - oldest first
      });

      // Filter to non-empty battles and identify empty ones for cleanup
      const nonEmptyBattles = battles.filter((battle) => battle.queue.length > 0);
      const emptyBattleIds = battles
        .filter((battle) => battle.queue.length === 0)
        .map((battle) => battle.id);

      // Non-blocking cleanup of empty queues (fire and forget)
      if (emptyBattleIds.length > 0) {
        void ctx.drizzle
          .delete(mpvpBattleQueue)
          .where(
            and(
              inArray(mpvpBattleQueue.id, emptyBattleIds),
              isNull(mpvpBattleQueue.battleId),
            ),
          );
      }

      return nonEmptyBattles;
    }),

  // Get user's currently queued shrine battle (to check which sector they're queued for)
  // Filter to active battles (battleId IS NULL) and order explicitly
  getUserQueuedShrineBattle: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get user's queued shrine battle" } })
    .query(async ({ ctx }) => {
      const shrineLobbyStaleBefore = shrineLobbyFreshAfter();
      const [activeEntry] = await ctx.drizzle
        .select({ battleId: mpvpBattleQueue.id, sector: mpvpBattleQueue.sector })
        .from(mpvpBattleUser)
        .innerJoin(mpvpBattleQueue, eq(mpvpBattleUser.clanBattleId, mpvpBattleQueue.id))
        .where(
          and(
            eq(mpvpBattleUser.userId, ctx.userId),
            eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
            isNull(mpvpBattleQueue.battleId),
            gt(mpvpBattleQueue.createdAt, shrineLobbyStaleBefore),
          ),
        )
        .orderBy(desc(mpvpBattleUser.createdAt))
        .limit(1);

      return activeEntry ?? null;
    }),

  // Challenge a shrine (create a new shrine battle queue)
  challengeShrine: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Challenge a shrine to battle" } })
    .input(z.object({ sectorNumber: z.number() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch user and sector data
      const [
        { user },
        targetSector,
        activeWars,
        relationships,
        isHome,
        existingUserBattles,
      ] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle.query.sector.findFirst({
          where: eq(sector.sector, input.sectorNumber),
          with: {
            village: true,
          },
        }),
        fetchActiveWars(ctx.drizzle),
        fetchAlliances(ctx.drizzle),
        ctx.drizzle.query.village.findFirst({
          where: eq(village.sector, input.sectorNumber),
        }),
        // Check if user is already in any active battle queue
        fetchActiveUserMpvpBattles(ctx.drizzle, ctx.userId),
      ]);

      // Helper to check if user is on attacker side (including allies)
      const isUserOnAttackerSide = (w: (typeof activeWars)[number]) =>
        w.attackerVillageId === user?.villageId ||
        w.warAllies?.some(
          (ally) =>
            ally.villageId === user?.villageId &&
            ally.supportVillageId === w.attackerVillageId,
        );

      // Helper to check if user is on defender side (including allies)
      const isUserOnDefenderSide = (w: (typeof activeWars)[number]) =>
        w.defenderVillageId === user?.villageId ||
        w.warAllies?.some(
          (ally) =>
            ally.villageId === user?.villageId &&
            ally.supportVillageId === w.defenderVillageId,
        );

      // Get the war the user is involved with
      // For SECTOR_WAR: check war.sector matches and user is attacker
      // For VILLAGE_WAR/WAR_RAID: check village sectors
      const userWar = activeWars.find((w) => {
        if (w.status !== "ACTIVE") return false;

        if (w.type === "SECTOR_WAR") {
          // Sector wars use war.sector and only attackers can attack
          return w.sector === input.sectorNumber && isUserOnAttackerSide(w);
        }

        if (["VILLAGE_WAR", "WAR_RAID"].includes(w.type)) {
          // Village wars/raids: check if user is at the opposing village's sector
          // Attackers attack at defender's village sector
          // Defenders counter-attack at attacker's village sector
          const atDefenderVillage = w.defenderVillage?.sector === input.sectorNumber;
          const atAttackerVillage = w.attackerVillage?.sector === input.sectorNumber;

          return (
            (atDefenderVillage && isUserOnAttackerSide(w)) ||
            (atAttackerVillage && isUserOnDefenderSide(w))
          );
        }

        return false;
      });

      // Check if this is a Village War or Raid (allows attacking home sectors)
      const isVillageWarOrRaid =
        userWar?.type === "VILLAGE_WAR" || userWar?.type === "WAR_RAID";

      // Relationship check
      const relationship = findRelationship(
        relationships,
        user?.villageId || "",
        targetSector?.villageId || "",
      );

      // Guards
      if (!user) return errorResponse("User not found");
      if (user.status !== "AWAKE") return errorResponse("Must be awake to challenge");
      if (!user.villageId) return errorResponse("You must be in a village");
      if (MAP_RESERVED_SECTORS.includes(input.sectorNumber)) {
        return errorResponse("This sector is reserved and cannot be attacked");
      }
      // Home sectors can only be attacked during Village Wars or Raids
      if (isHome && !isVillageWarOrRaid) {
        return errorResponse("Cannot attack shrines in village home sectors");
      }
      if (!targetSector) return errorResponse("Sector not found");
      if (!targetSector.villageId)
        return errorResponse("This sector has no shrine to attack");
      if (targetSector.villageId === user.villageId)
        return errorResponse("Cannot attack your own village's shrine");

      // Sector war or village war check
      const isSyndicate = targetSector.villageId === VILLAGE_SYNDICATE_ID;
      if (!userWar && relationship?.status !== "ENEMY" && !isSyndicate) {
        return errorResponse(
          "You can only attack shrines in sectors where your village has declared a sector war or if you are at war with that village",
        );
      }

      // Check if user is already in any battle queue
      if (existingUserBattles.length > 0) {
        return errorResponse("Already in a battle queue");
      }

      // Create new shrine battle queue with rollback on failure
      const shrineBattleId = nanoid();
      const result = await ctx.drizzle
        .update(userData)
        .set({ status: "QUEUED" })
        .where(and(eq(userData.userId, user.userId), eq(userData.status, "AWAKE")));
      if (result.rowsAffected === 0) return errorResponse("Was not awake?");

      try {
        // Insert queue first, then user - sequence allows compensating delete on failure
        await ctx.drizzle.insert(mpvpBattleQueue).values({
          id: shrineBattleId,
          createdAt: new Date(),
          battleType: "SHRINE_BATTLE",
          attackerEntityId: user.villageId,
          defenderEntityId: targetSector.villageId,
          sector: input.sectorNumber,
        });

        try {
          await ctx.drizzle.insert(mpvpBattleUser).values({
            id: nanoid(),
            userId: user.userId,
            clanBattleId: shrineBattleId,
            side: "ATTACKER",
            slot: 0, // First attacker gets slot 0
          });
        } catch (userInsertError) {
          // Compensating delete: remove the queue we just created
          await ctx.drizzle
            .delete(mpvpBattleQueue)
            .where(eq(mpvpBattleQueue.id, shrineBattleId));
          throw userInsertError;
        }
      } catch (error) {
        // Rollback user status on any insert failure
        await ctx.drizzle
          .update(userData)
          .set({ status: "AWAKE" })
          .where(eq(userData.userId, user.userId));
        throw error;
      }

      // Notify the defending village via village channel
      void pusher.trigger(`village-${targetSector.villageId}`, "event", {
        type: "villageAlert",
        alertType: "SHRINE_UNDER_ATTACK",
        sector: input.sectorNumber,
        message: `Sector ${input.sectorNumber} is under attack! Your village's shrine is being challenged.`,
        route: "/travel",
        routeText: "Go to Map",
      });

      return {
        success: true,
        message: `Shrine attack party created! Waiting for more attackers (min ${SHRINE_BATTLE_MIN_ATTACKERS})`,
      };
    }),

  // Join a shrine battle queue
  joinShrineBattle: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Join a shrine battle queue" } })
    .input(
      z.object({
        shrineBattleId: z.string(),
        side: z.enum(["ATTACKER", "DEFENDER"]),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const shrineLobbyStaleBefore = shrineLobbyFreshAfter();

      // Fetch user and battle data
      const [{ user }, shrineBattle, existingUserBattles] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle.query.mpvpBattleQueue.findFirst({
          where: and(
            eq(mpvpBattleQueue.id, input.shrineBattleId),
            eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
            gt(mpvpBattleQueue.createdAt, shrineLobbyStaleBefore),
          ),
          with: {
            queue: {
              with: {
                user: {
                  columns: {
                    username: true,
                    villageId: true,
                  },
                },
              },
            },
          },
        }),
        // Check if user is already in any active battle queue
        fetchActiveUserMpvpBattles(ctx.drizzle, ctx.userId),
      ]);

      // Guards
      if (!user) return errorResponse("User not found");
      if (user.status !== "AWAKE") return errorResponse("Must be awake to join");
      if (!user.villageId) return errorResponse("You must be in a village");
      if (!shrineBattle) return errorResponse("Shrine battle not found");
      if (shrineBattle.battleId) return errorResponse("Shrine battle already started");

      // Check if user is already in any battle queue
      if (existingUserBattles.length > 0) {
        return errorResponse("Already in a battle queue");
      }

      // Validate side based on village
      if (input.side === "ATTACKER") {
        if (user.villageId === shrineBattle.defenderEntityId) {
          return errorResponse("Defenders cannot join as attackers");
        }
      } else {
        if (user.villageId !== shrineBattle.defenderEntityId) {
          return errorResponse("Only shrine village members can defend");
        }
      }

      // Find available slots for this side
      const existingSlots = shrineBattle.queue
        .filter((q) => q.side === input.side)
        .map((q) => q.slot)
        .filter((s): s is number => s !== null);

      // Find first available slot (0-based)
      let availableSlot: number | null = null;
      for (let i = 0; i < SHRINE_BATTLE_MAX_USERS_PER_SIDE; i++) {
        if (!existingSlots.includes(i)) {
          availableSlot = i;
          break;
        }
      }

      if (availableSlot === null) {
        return errorResponse(
          `Maximum ${SHRINE_BATTLE_MAX_USERS_PER_SIDE} ${input.side.toLowerCase()}s allowed`,
        );
      }

      // Update user status
      const result = await ctx.drizzle
        .update(userData)
        .set({ status: "QUEUED" })
        .where(and(eq(userData.userId, user.userId), eq(userData.status, "AWAKE")));
      if (result.rowsAffected === 0) return errorResponse("Was not awake?");

      // Try to insert with slot - unique constraint prevents race conditions
      try {
        await ctx.drizzle.insert(mpvpBattleUser).values({
          id: nanoid(),
          userId: user.userId,
          clanBattleId: input.shrineBattleId,
          side: input.side,
          slot: availableSlot,
        });
      } catch (error) {
        // On any insert failure, verify user status and revert if needed
        const isDuplicateError = isMysqlDuplicateKeyError(error);

        // Verify user is still QUEUED and not in any queue before reverting
        const [currentUser, existingEntry] = await Promise.all([
          ctx.drizzle.query.userData.findFirst({
            where: eq(userData.userId, user.userId),
            columns: { status: true },
          }),
          ctx.drizzle.query.mpvpBattleUser.findFirst({
            where: and(
              eq(mpvpBattleUser.userId, user.userId),
              eq(mpvpBattleUser.clanBattleId, input.shrineBattleId),
            ),
          }),
        ]);

        // Only revert if user is still QUEUED and not in this battle
        if (currentUser?.status === "QUEUED" && !existingEntry) {
          await ctx.drizzle
            .update(userData)
            .set({ status: "AWAKE" })
            .where(
              and(eq(userData.userId, user.userId), eq(userData.status, "QUEUED")),
            );
        }

        if (isDuplicateError) {
          return errorResponse("Slot was taken by another player. Please try again.");
        }
        // For other errors, rethrow after status revert
        throw error;
      }

      return {
        success: true,
        message: `Joined shrine battle as ${input.side.toLowerCase()}`,
      };
    }),

  // Leave a shrine battle queue (DB-guarded writes to prevent races)
  leaveShrineBattle: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Leave a shrine battle queue" } })
    .input(z.object({ shrineBattleId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch user data
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });

      // Guards
      if (!user) return errorResponse("User not found");
      if (user.status !== "QUEUED") return errorResponse("Not queued");

      const shrineLobbyStaleBefore = shrineLobbyFreshAfter();

      // Use a subquery to only delete if the parent battle hasn't started and isn't stale
      // This ensures atomic check + delete for the mpvpBattleUser row
      const activeQueueSubquery = ctx.drizzle
        .select({ id: mpvpBattleQueue.id })
        .from(mpvpBattleQueue)
        .where(
          and(
            eq(mpvpBattleQueue.id, input.shrineBattleId),
            isNull(mpvpBattleQueue.battleId),
            gt(mpvpBattleQueue.createdAt, shrineLobbyStaleBefore),
          ),
        );

      const deleteResult = await ctx.drizzle
        .delete(mpvpBattleUser)
        .where(
          and(
            eq(mpvpBattleUser.userId, user.userId),
            inArray(mpvpBattleUser.clanBattleId, activeQueueSubquery),
          ),
        );

      // If no rows deleted, either user wasn't in queue, battle started, or lobby expired
      if (deleteResult.rowsAffected === 0) {
        const battle = await ctx.drizzle.query.mpvpBattleQueue.findFirst({
          where: eq(mpvpBattleQueue.id, input.shrineBattleId),
          columns: { battleId: true, createdAt: true },
        });
        if (battle?.battleId) {
          return errorResponse("Shrine battle already started - cannot leave");
        }
        if (battle && battle.createdAt <= shrineLobbyStaleBefore) {
          // Lobby is confirmed stale — reset status immediately so the user
          // isn't blocked until the cron tick clears it.
          await ctx.drizzle
            .update(userData)
            .set({ status: "AWAKE" })
            .where(
              and(eq(userData.userId, user.userId), eq(userData.status, "QUEUED")),
            );
          return errorResponse("Shrine battle expired");
        }
        return errorResponse("Not in this shrine battle queue");
      }

      // Only update user status if we successfully deleted the queue entry
      await ctx.drizzle
        .update(userData)
        .set({ status: "AWAKE" })
        .where(and(eq(userData.userId, user.userId), eq(userData.status, "QUEUED")));

      // If no one left in queue, delete the battle queue
      const counts = await ctx.drizzle
        .select({ remaining: sql<number>`count(*)` })
        .from(mpvpBattleUser)
        .where(eq(mpvpBattleUser.clanBattleId, input.shrineBattleId));
      const remaining = counts[0]?.remaining ?? 0;

      if (remaining === 0) {
        // Only delete if battleId is still null (battle hasn't started)
        await ctx.drizzle
          .delete(mpvpBattleQueue)
          .where(
            and(
              eq(mpvpBattleQueue.id, input.shrineBattleId),
              isNull(mpvpBattleQueue.battleId),
            ),
          );
      }

      return { success: true, message: "Left shrine battle queue" };
    }),

  // Initiate shrine battle (start the battle after lobby time)
  // Fixed double-start race with atomic claim BEFORE initiateBattle()
  initiateShrineBattle: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Start a shrine battle" } })
    .input(z.object({ shrineBattleId: z.string() }))
    .output(baseServerResponse.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const shrineLobbyStaleBefore = shrineLobbyFreshAfter();

      // Fetch user and battle data
      const [{ user }, shrineBattle, activeWars, relationships] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle.query.mpvpBattleQueue.findFirst({
          where: and(
            eq(mpvpBattleQueue.id, input.shrineBattleId),
            eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
            gt(mpvpBattleQueue.createdAt, shrineLobbyStaleBefore),
          ),
          with: {
            queue: {
              with: {
                user: {
                  columns: {
                    username: true,
                    villageId: true,
                  },
                },
              },
            },
          },
        }),
        fetchActiveWars(ctx.drizzle),
        fetchAlliances(ctx.drizzle),
      ]);

      // Guards
      if (!user) return errorResponse("User not found");
      if (!shrineBattle) return errorResponse("Shrine battle not found");
      if (shrineBattle.battleId) return errorResponse("Battle already initiated");

      // Check if user is in the queue as an attacker (only attackers can initiate)
      const userQueueEntry = shrineBattle.queue.find((q) => q.userId === user.userId);
      if (!userQueueEntry) return errorResponse("Not in this shrine battle");
      if (userQueueEntry.side !== "ATTACKER") {
        return errorResponse("Only attackers can initiate the shrine battle");
      }

      // Get the war the user is involved with
      const userWar = activeWars.find(
        (w) =>
          w.attackerVillageId === user?.villageId &&
          w.sector === shrineBattle.sector &&
          w.status === "ACTIVE" &&
          w.type === "SECTOR_WAR",
      );

      // Relationship check
      const relationship = findRelationship(
        relationships,
        user?.villageId || "",
        shrineBattle.defenderEntityId || "",
      );

      // Sector war or village war check
      const isSyndicate = shrineBattle.defenderEntityId === VILLAGE_SYNDICATE_ID;
      if (!userWar && relationship?.status !== "ENEMY" && !isSyndicate) {
        return errorResponse(
          "You can only attack shrines in sectors where your village has declared a sector war or if you are at war with that village",
        );
      }

      // Check lobby time has passed
      if (
        new Date() <
        secondsFromDate(SHRINE_BATTLE_LOBBY_SECONDS, shrineBattle.createdAt)
      ) {
        return errorResponse("Shrine battle lobby time has not passed yet");
      }

      // Get attackers and defenders
      const attackers = shrineBattle.queue.filter((q) => q.side === "ATTACKER");
      const defenders = shrineBattle.queue.filter((q) => q.side === "DEFENDER");
      const allUserIds = shrineBattle.queue.map((q) => q.userId);

      // Check minimum attackers
      if (attackers.length < SHRINE_BATTLE_MIN_ATTACKERS) {
        return errorResponse(
          `Need at least ${SHRINE_BATTLE_MIN_ATTACKERS} attackers to start`,
        );
      }

      // Prepare attacker and defender IDs
      const attackerIds = attackers.map((a) => a.userId);
      let defenderIds: string[] = defenders.map((d) => d.userId);

      // If no player defenders, use AI defenders from the defender village
      if (defenderIds.length === 0) {
        // Use defenderEntityId directly - it's the village ID for shrine battles
        const defenderVillage = await ctx.drizzle.query.village.findFirst({
          where: eq(village.id, shrineBattle.defenderEntityId),
        });
        if (defenderVillage?.shrineSettings?.activeAiIds) {
          defenderIds = defenderVillage.shrineSettings.activeAiIds.slice(
            0,
            SHRINE_BATTLE_MAX_USERS_PER_SIDE,
          );
        }
        // If still no village-configured AI, fall back to global shrine AIs
        if (defenderIds.length === 0) {
          const globalAiDefenders = await ctx.drizzle.query.userData.findMany({
            where: and(eq(userData.isAi, true), eq(userData.inShrines, true)),
            columns: { userId: true },
            limit: SHRINE_BATTLE_MAX_USERS_PER_SIDE,
          });
          defenderIds = globalAiDefenders.map((ai) => ai.userId);
        }
        // Final fallback: use the same hardcoded AI as solo shrine battles
        if (defenderIds.length === 0) {
          defenderIds = ["MJMzOE67Cx2YP3NX8SAbh"];
        }
      }

      // CRITICAL: Claim the battle BEFORE calling initiateBattle()
      // Use a placeholder battle ID to atomically claim this queue
      const claimId = `claiming-${nanoid()}`;
      const claimResult = await ctx.drizzle
        .update(mpvpBattleQueue)
        .set({ battleId: claimId })
        .where(
          and(
            eq(mpvpBattleQueue.id, input.shrineBattleId),
            isNull(mpvpBattleQueue.battleId),
          ),
        );

      // If no rows updated, another process already claimed this battle
      if (claimResult.rowsAffected === 0) {
        return errorResponse("Battle was already initiated by another participant");
      }

      // Now we have exclusive ownership - start the battle
      const result = await initiateBattle(
        {
          userIds: attackerIds,
          targetIds: defenderIds,
          client: ctx.drizzle,
          biome: "default",
          forceDefenderVillageId: shrineBattle.defenderEntityId,
        },
        "SHRINE_WAR",
      );

      if (result.success && result.battleId) {
        // Update with the real battleId (replace our claim placeholder)
        await ctx.drizzle
          .update(mpvpBattleQueue)
          .set({ battleId: result.battleId })
          .where(eq(mpvpBattleQueue.id, input.shrineBattleId));

        // Note: initiateBattle() sets human participants to status="BATTLE".
        // AI defender rows are never claimed or modified — the shared AI row
        // is cloned into the battle state instead, so it stays untouched.

        // Notify participants
        allUserIds.forEach((userId) => {
          void pusher.trigger(userId, "event", {
            type: "userMessage",
            message: "Shrine battle has started!",
            route: "/combat",
            routeText: "To Combat",
          });
        });

        return {
          success: true,
          message: "Shrine battle initiated!",
          battleId: result.battleId,
        };
      }

      // If initiateBattle failed, release the claim so others can try
      await ctx.drizzle
        .update(mpvpBattleQueue)
        .set({ battleId: null })
        .where(
          and(
            eq(mpvpBattleQueue.id, input.shrineBattleId),
            eq(mpvpBattleQueue.battleId, claimId),
          ),
        );

      return errorResponse(`Failed to initiate shrine battle: ${result.message}`);
    }),
});

/**
 * Returns whether the village controls at least one Level 3 shrine.
 * Existence-only check — selects a single id rather than pulling full sector rows.
 */
const hasLevel3Shrine = async (
  client: DrizzleClient,
  villageId: string,
): Promise<boolean> => {
  const rows = await client
    .select({ id: sector.id })
    .from(sector)
    .where(and(eq(sector.villageId, villageId), eq(sector.shrineLevel, 3)))
    .limit(1);
  return rows.length > 0;
};
