import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { baseServerResponse, errorResponse } from "../trpc";
import { nanoid } from "nanoid";
import { eq, and, gte, sql, asc } from "drizzle-orm";
import {
  SHRINE_UPGRADE_COST,
  SHRINE_BOOST_DURATION_HOURS,
  SHRINE_AI_UNLOCK_COST,
  SHRINE_MAX_AI_ASSIGNMENTS,
  SHRINE_MAX_LEVEL,
  SHRINE_WEEKLY_MAINTENANCE_COST,
  SHRINE_BOOST_TYPES,
  SHRINE_BOOST_COST,
  WAR_SHRINE_MAINTENANCE_DAYS,
} from "@/drizzle/constants";
import { sector, village, userData, war, shrineBattleQueue, shrineBattleUser } from "@/drizzle/schema";
import { initiateBattle } from "@/routers/combat";
import { fetchUpdatedUser, fetchUser } from "@/routers/profile";
import { secondsFromDate, secondsFromNow } from "@/utils/time";

export const shrineRouter = createTRPCRouter({
  // Get all AI names
  getShrineAis: publicProcedure.query(async ({ ctx }) => {
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
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sectors = await ctx.drizzle.query.sector.findMany({
        where: eq(sector.villageId, input.villageId),
      });
      return sectors;
    }),
  // Upgrade a shrine level (simplified version)
  upgradeShrine: protectedProcedure
    .input(z.object({ sectorNumber: z.number() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
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
      if (!user?.villageId) {
        return errorResponse("You must be in a village");
      }
      if (!targetSector) {
        return errorResponse("Sector not found");
      }
      if (targetSector.villageId !== user.villageId) {
        return errorResponse("You can only upgrade your own shrines");
      }
      if (targetSector.shrineLevel >= SHRINE_MAX_LEVEL) {
        return errorResponse(`Shrine level cannot exceed ${SHRINE_MAX_LEVEL}`);
      }
      if (user?.village?.kageId !== user.userId) {
        return errorResponse("Only the Kage can upgrade shrines");
      }
      if (user?.village?.tokens < SHRINE_UPGRADE_COST) {
        return errorResponse(
          `Need ${SHRINE_UPGRADE_COST.toLocaleString()} tokens to upgrade shrine`,
        );
      }

      // Calculate new HP and perform upgrade
      await Promise.all([
        ctx.drizzle
          .update(sector)
          .set({ shrineLevel: targetSector.shrineLevel + 1 })
          .where(eq(sector.sector, input.sectorNumber)),
        ctx.drizzle
          .update(village)
          .set({ tokens: user.village.tokens - SHRINE_UPGRADE_COST })
          .where(eq(village.id, user.villageId)),
      ]);

      return {
        success: true,
        message: `Successfully upgraded shrine to level ${targetSector.shrineLevel + 1}!`,
      };
    }),

  // Activate village-wide boost (requires level 3 shrine)
  activateBoost: protectedProcedure
    .input(z.object({ boostType: z.enum(SHRINE_BOOST_TYPES), villageId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, level3Shrines] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle.query.sector.findMany({
          where: and(eq(sector.villageId, input.villageId), eq(sector.shrineLevel, 3)),
        }),
      ]);
      // Guards
      if (!user?.villageId) {
        return errorResponse("You must be in a village");
      }
      if (user.villageId !== input.villageId) {
        return errorResponse("You can only activate boosts for your own village");
      }
      if (!user.village) {
        return errorResponse("Village not found");
      }
      if (user.village?.kageId !== user.userId) {
        return errorResponse("Only the Kage can activate boosts");
      }
      if (level3Shrines.length === 0) {
        return errorResponse("Need at least one Level 3 shrine to activate boosts");
      }
      if (user.village.tokens < SHRINE_BOOST_COST) {
        return errorResponse(
          `Need ${SHRINE_BOOST_COST.toLocaleString()} tokens to activate boosts`,
        );
      }

      // Check if boost is already active
      const currentBoosts = user.village.shrineSettings.activeBoosts || {};
      const existingBoost = currentBoosts[input.boostType];
      if (existingBoost && new Date(existingBoost) > new Date()) {
        return errorResponse(`${input.boostType} boost is already active`);
      }

      // Update active boosts
      const boostExpiry = secondsFromNow(SHRINE_BOOST_DURATION_HOURS * 60 * 60);
      const updatedBoosts = {
        ...currentBoosts,
        [input.boostType]: boostExpiry.toISOString(),
      };

      // Run mutation to do update
      await ctx.drizzle
        .update(village)
        .set({
          tokens: sql`${village.tokens} - ${SHRINE_BOOST_COST}`,
          shrineSettings: {
            ...user.village.shrineSettings,
            activeBoosts: updatedBoosts,
          },
        })
        .where(eq(village.id, user.villageId));

      return {
        success: true,
        message: `${input.boostType} boost activated for ${SHRINE_BOOST_DURATION_HOURS} hours!`,
      };
    }),

  // Unlock AI defender type for village (Kage only)
  unlockAiDefender: protectedProcedure
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

      // Guards
      if (!user) {
        return errorResponse("User not found");
      }
      if (!user.village || !user.villageId) {
        return errorResponse("You must be in a village");
      }
      if (user.village.kageId !== user.userId) {
        return errorResponse("Only the Kage can unlock AI defenders");
      }
      if (user.village.tokens < SHRINE_AI_UNLOCK_COST) {
        return errorResponse(
          `Need ${SHRINE_AI_UNLOCK_COST.toLocaleString()} tokens to unlock AI defender`,
        );
      }
      if (!ai) {
        return errorResponse("AI not found");
      }
      const currentUnlocks = user.village.shrineSettings.unlockedAiIds || [];
      if (currentUnlocks.includes(input.aiId)) {
        return errorResponse("AI defender already unlocked");
      }

      // Update unlocked AI types
      const updatedUnlocks = [...currentUnlocks, input.aiId];

      // Deduct tokens and update unlocked AI IDs
      await ctx.drizzle
        .update(village)
        .set({
          tokens: sql`${village.tokens} - ${SHRINE_AI_UNLOCK_COST}`,
          shrineSettings: {
            ...user.village.shrineSettings,
            unlockedAiIds: updatedUnlocks,
          },
        })
        .where(
          and(
            eq(village.id, user.villageId),
            gte(village.tokens, SHRINE_AI_UNLOCK_COST),
          ),
        );

      return {
        success: true,
        message: `AI defender unlocked! Cost: ${SHRINE_AI_UNLOCK_COST.toLocaleString()} tokens`,
      };
    }),

  // Toggle village-wide AI defender
  toggleVillageAiDefender: protectedProcedure
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

      // Guards
      if (!user) {
        return errorResponse("User not found");
      }
      if (!user.village || !user.villageId) {
        return errorResponse("You must be in a village");
      }
      if (user.village.kageId !== user.userId) {
        return errorResponse("Only the Kage can manage AI defenders");
      }
      if (!ai) {
        return errorResponse("AI not found");
      }

      const currentUnlocks = user.village.shrineSettings.unlockedAiIds || [];
      const currentAssigns = user.village.shrineSettings.activeAiIds || [];

      if (!currentUnlocks.includes(input.aiId)) {
        return errorResponse("AI defender not unlocked");
      }

      let newAssigns: string[];
      let message: string;

      if (currentAssigns.includes(input.aiId)) {
        // Remove AI defender (deselect)
        newAssigns = currentAssigns.filter((id) => id !== input.aiId);
        message = `AI defender ${ai.username} removed from active defenders`;
      } else {
        // Add AI defender (select)
        if (currentAssigns.length >= SHRINE_MAX_AI_ASSIGNMENTS) {
          return errorResponse(
            `Can only assign up to ${SHRINE_MAX_AI_ASSIGNMENTS} AI defenders`,
          );
        }
        newAssigns = [...currentAssigns, input.aiId];
        message = `AI defender ${ai.username} added to active defenders`;
      }

      // Run update mutation
      await ctx.drizzle
        .update(village)
        .set({
          shrineSettings: {
            ...user.village.shrineSettings,
            activeAiIds: newAssigns,
          },
        })
        .where(eq(village.id, user.villageId));

      return { success: true, message };
    }),

  // Weekly maintenance payment per sector
  payWeeklyMaintenance: protectedProcedure
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
          with: {
            village: true,
          },
        }),
      ]);

      // Guards
      if (!user) {
        return errorResponse("User not found");
      }
      if (!user.village || !user.villageId) {
        return errorResponse("You must be in a village");
      }
      if (!targetSector) {
        return errorResponse("Sector not found");
      }
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

      // Update payment and maintenance date for the specific sector
      await Promise.all([
        ctx.drizzle
          .update(village)
          .set({
            tokens: sql`${village.tokens} - ${SHRINE_WEEKLY_MAINTENANCE_COST}`,
          })
          .where(
            and(
              eq(village.id, user.villageId),
              gte(village.tokens, SHRINE_WEEKLY_MAINTENANCE_COST),
            ),
          ),
        ctx.drizzle
          .update(sector)
          .set({
            nextMaintainanceDueDate: nextNextMaintainanceDueDate,
          })
          .where(eq(sector.id, input.sectorId)),
      ]);

      return {
        success: true,
        message: `Weekly maintenance paid for sector ${targetSector.sector}: ${SHRINE_WEEKLY_MAINTENANCE_COST.toLocaleString()} tokens`,
      };
    }),

  // Shrine battle queue: attackers queue to challenge a shrine with up to 3 players.
  // Defenders (village owning the shrine) can optionally queue to defend with up to 3 players.
  queueForShrineAttack: protectedProcedure
    .input(z.object({ sector: z.number().int() }))
    .output(baseServerResponse.extend({ shrineBattleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [{ user }, activeWar, sectorData] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        ctx.drizzle.query.war.findFirst({
          where: and(eq(war.sector, input.sector), eq(war.status, "ACTIVE"), eq(war.type, "SECTOR_WAR")),
        }),
        ctx.drizzle.query.sector.findFirst({ where: eq(sector.sector, input.sector), with: { village: true } }),
      ]);

      if (!user) return errorResponse("User not found");
      if (!activeWar) return errorResponse("No active sector war here");
      if (!sectorData) return errorResponse("Sector not found");
      if (user.sector !== input.sector) return errorResponse("Not in the correct sector");
      if (user.isBanned) return errorResponse("User is banned");
      if (user.villageId !== activeWar.attackerVillageId)
        return errorResponse("Only attackers can queue here");

      // Find or create shrine battle queue for this sector/war pairing
      let shrineBattle = await ctx.drizzle.query.shrineBattleQueue.findFirst({
        where: and(
          eq(shrineBattleQueue.sector, input.sector),
          eq(shrineBattleQueue.attackerVillageId, activeWar.attackerVillageId),
          eq(shrineBattleQueue.defenderVillageId, activeWar.defenderVillageId),
        ),
        with: { queue: true },
      });

      if (!shrineBattle) {
        const id = nanoid();
        await ctx.drizzle.insert(shrineBattleQueue).values({
          id,
          sector: input.sector,
          attackerVillageId: activeWar.attackerVillageId,
          defenderVillageId: activeWar.defenderVillageId,
          createdAt: new Date(),
        });
        shrineBattle = await ctx.drizzle.query.shrineBattleQueue.findFirst({
          where: eq(shrineBattleQueue.id, id),
          with: { queue: true },
        });
      }

      if (!shrineBattle) return errorResponse("Failed to create shrine queue");

      const alreadyQueued = shrineBattle.queue.some((q) => q.userId === user.userId);
      if (alreadyQueued) return errorResponse("Already in shrine queue");

      const attackers = shrineBattle.queue.filter((q) => q.role === "ATTACKER");
      if (attackers.length >= 3) return errorResponse("Attacker queue is full (max 3)");

      await ctx.drizzle.insert(shrineBattleUser).values({
        id: nanoid(),
        shrineBattleId: shrineBattle.id,
        userId: user.userId,
        role: "ATTACKER",
        createdAt: new Date(),
      });

      return { success: true, message: "Joined shrine attack queue", shrineBattleId: shrineBattle.id };
    }),

  queueForShrineDefense: protectedProcedure
    .input(z.object({ sector: z.number().int() }))
    .output(baseServerResponse.extend({ shrineBattleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [{ user }, activeWar, sectorData] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        ctx.drizzle.query.war.findFirst({
          where: and(eq(war.sector, input.sector), eq(war.status, "ACTIVE"), eq(war.type, "SECTOR_WAR")),
        }),
        ctx.drizzle.query.sector.findFirst({ where: eq(sector.sector, input.sector), with: { village: true } }),
      ]);

      if (!user) return errorResponse("User not found");
      if (!activeWar) return errorResponse("No active sector war here");
      if (!sectorData) return errorResponse("Sector not found");
      if (user.sector !== input.sector) return errorResponse("Not in the correct sector");
      if (user.isBanned) return errorResponse("User is banned");
      if (user.villageId !== activeWar.defenderVillageId)
        return errorResponse("Only defenders can queue here");

      // Find or create shrine battle queue
      let shrineBattle = await ctx.drizzle.query.shrineBattleQueue.findFirst({
        where: and(
          eq(shrineBattleQueue.sector, input.sector),
          eq(shrineBattleQueue.attackerVillageId, activeWar.attackerVillageId),
          eq(shrineBattleQueue.defenderVillageId, activeWar.defenderVillageId),
        ),
        with: { queue: true },
      });

      if (!shrineBattle) {
        const id = nanoid();
        await ctx.drizzle.insert(shrineBattleQueue).values({
          id,
          sector: input.sector,
          attackerVillageId: activeWar.attackerVillageId,
          defenderVillageId: activeWar.defenderVillageId,
          createdAt: new Date(),
        });
        shrineBattle = await ctx.drizzle.query.shrineBattleQueue.findFirst({
          where: eq(shrineBattleQueue.id, id),
          with: { queue: true },
        });
      }

      if (!shrineBattle) return errorResponse("Failed to create shrine queue");

      const alreadyQueued = shrineBattle.queue.some((q) => q.userId === user.userId);
      if (alreadyQueued) return errorResponse("Already in shrine queue");

      const defenders = shrineBattle.queue.filter((q) => q.role === "DEFENDER");
      if (defenders.length >= 3) return errorResponse("Defender queue is full (max 3)");

      await ctx.drizzle.insert(shrineBattleUser).values({
        id: nanoid(),
        shrineBattleId: shrineBattle.id,
        userId: user.userId,
        role: "DEFENDER",
        createdAt: new Date(),
      });

      return { success: true, message: "Joined shrine defense queue", shrineBattleId: shrineBattle.id };
    }),

  leaveShrineQueue: protectedProcedure
    .input(z.object({ sector: z.number().int() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [{ user }, shrineBattle] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        ctx.drizzle.query.shrineBattleQueue.findFirst({
          where: eq(shrineBattleQueue.sector, input.sector),
          with: { queue: true },
        }),
      ]);

      if (!user) return errorResponse("User not found");
      if (!shrineBattle) return errorResponse("No shrine queue here");

      const queued = shrineBattle.queue.find((q) => q.userId === user.userId);
      if (!queued) return errorResponse("Not in the shrine queue");

      await ctx.drizzle
        .delete(shrineBattleUser)
        .where(and(eq(shrineBattleUser.shrineBattleId, shrineBattle.id), eq(shrineBattleUser.userId, user.userId)));

      // Cleanup empty queue
      const remaining = await ctx.drizzle.query.shrineBattleUser.findMany({
        where: eq(shrineBattleUser.shrineBattleId, shrineBattle.id),
      });
      if (remaining.length === 0) {
        await ctx.drizzle.delete(shrineBattleQueue).where(eq(shrineBattleQueue.id, shrineBattle.id));
      }

      return { success: true, message: "Left shrine queue" };
    }),

  // Attempt to start a shrine battle if minimum attackers are present.
  // If no human defenders queued, use AI defenders assigned to the shrine.
  initiateShrineBattle: protectedProcedure
    .input(z.object({ sector: z.number().int() }))
    .output(baseServerResponse.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [{ user }, activeWar, sectorData, shrineBattle, shrineAis] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        ctx.drizzle.query.war.findFirst({
          where: and(eq(war.sector, input.sector), eq(war.status, "ACTIVE"), eq(war.type, "SECTOR_WAR")),
        }),
        ctx.drizzle.query.sector.findFirst({
          where: eq(sector.sector, input.sector),
          with: { village: true },
        }),
        ctx.drizzle.query.shrineBattleQueue.findFirst({
          where: eq(shrineBattleQueue.sector, input.sector),
          with: {
            queue: {
              columns: { userId: true, role: true, createdAt: true },
              with: { user: { columns: { status: true } } },
            },
          },
        }),
        ctx.drizzle.query.userData.findMany({
          where: and(eq(userData.isAi, true), eq(userData.inShrines, true)),
          columns: { userId: true },
        }),
      ]);

      if (!user) return errorResponse("User not found");
      if (!activeWar) return errorResponse("No active sector war here");
      if (!sectorData) return errorResponse("Sector not found");
      if (user.sector !== input.sector) return errorResponse("Not in the correct sector");

      // Determine attacker/defender grouping
      const attackers = (shrineBattle?.queue ?? [])
        .filter((q) => q.role === "ATTACKER")
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((q) => q.userId);

      if (attackers.length < 2) return { success: false, message: "Need at least 2 attackers to start" };

      const maxTeam = 3;
      const attackerIds = attackers.slice(0, Math.min(maxTeam, attackers.length));

      const defenders = (shrineBattle?.queue ?? [])
        .filter((q) => q.role === "DEFENDER")
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((q) => q.userId);

      const assignedAis = sectorData.village?.shrineSettings?.activeAiIds || [];
      const validAis = shrineAis.filter((ai) => assignedAis.includes(ai.userId));
      const fallbackAi = ["MJMzOE67Cx2YP3NX8SAbh"];

      const needCount = attackerIds.length;
      const defenderIds =
        defenders.length > 0 ? defenders.slice(0, needCount) : (validAis.length > 0 ? validAis.map((a) => a.userId) : fallbackAi).slice(0, needCount);

      const result = await initiateBattle(
        {
          sector: input.sector,
          userIds: attackerIds,
          targetIds: defenderIds,
          forceDefenderVillageId: activeWar.defenderVillageId,
          client: ctx.drizzle,
          asset: "arena",
        },
        "SHRINE_WAR",
      );

      if (result.success && result.battleId && shrineBattle) {
        await ctx.drizzle
          .update(shrineBattleQueue)
          .set({ battleId: result.battleId })
          .where(eq(shrineBattleQueue.id, shrineBattle.id));
      }

      return { success: result.success, message: result.message, battleId: result.battleId };
    }),
});
