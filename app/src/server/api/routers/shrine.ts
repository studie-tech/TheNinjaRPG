import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { baseServerResponse, errorResponse } from "../trpc";
import { eq, and, gte, sql, asc } from "drizzle-orm";
import {
  SHRINE_UPGRADE_COST,
  SHRINE_BOOST_DURATION_HOURS,
  SHRINE_AI_UNLOCK_COST,
  SHRINE_MAX_AI_ASSIGNMENTS,
  SHRINE_MAX_LEVEL,
  SHRINE_WEEKLY_MAINTENANCE_COST,
  SHRINE_BOOST_TYPES,
  WAR_SHRINE_MAINTENANCE_DAYS,
} from "@/drizzle/constants";
import { sector, village, userData } from "@/drizzle/schema";
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

  // Set village-wide AI defender
  setVillageAiDefender: protectedProcedure
    .input(z.object({ aiId: z.string().nullable() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Queries
      const [{ user }, ai] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        input.aiId ? fetchUser(ctx.drizzle, input.aiId) : null,
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
      const currentUnlocks = user.village.shrineSettings.unlockedAiIds || [];
      const currentAssigns = user.village.shrineSettings.activeAiIds || [];
      const newAssigns = [];
      if (input.aiId) {
        if (!ai) {
          return errorResponse("AI not found");
        }
        if (!currentUnlocks.includes(input.aiId)) {
          return errorResponse("AI defender not unlocked");
        }
        if (currentAssigns.includes(input.aiId)) {
          return errorResponse("AI defender already assigned");
        }
        newAssigns.push(...currentAssigns, input.aiId);
        if (newAssigns.length > SHRINE_MAX_AI_ASSIGNMENTS) {
          return errorResponse(
            `Can only assign up to ${SHRINE_MAX_AI_ASSIGNMENTS} AI defenders`,
          );
        }
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

      return { success: true, message: "Village AI defender set successfully" };
    }),

  // Weekly maintenance payment
  payWeeklyMaintenance: protectedProcedure
    .input(z.object({ villageId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [{ user }] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
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
      if (user.village.tokens < SHRINE_WEEKLY_MAINTENANCE_COST) {
        return errorResponse(
          `Need ${SHRINE_WEEKLY_MAINTENANCE_COST.toLocaleString()} tokens for maintenance`,
        );
      }
      const currentNextMaintainanceDueDate = user.village.shrineSettings
        .nextMaintainanceDueDate
        ? new Date(user.village.shrineSettings.nextMaintainanceDueDate)
        : new Date();
      const nextNextMaintainanceDueDate = secondsFromDate(
        WAR_SHRINE_MAINTENANCE_DAYS * 24 * 60 * 60,
        currentNextMaintainanceDueDate,
      );

      // Update payment and maintenance date
      await ctx.drizzle
        .update(village)
        .set({
          tokens: sql`${village.tokens} - ${SHRINE_WEEKLY_MAINTENANCE_COST}`,
          shrineSettings: {
            ...user.village.shrineSettings,
            nextMaintainanceDueDate: nextNextMaintainanceDueDate.toISOString(),
          },
        })
        .where(
          and(
            eq(village.id, input.villageId),
            gte(village.tokens, SHRINE_WEEKLY_MAINTENANCE_COST),
          ),
        );

      return {
        success: true,
        message: `Weekly maintenance paid: ${SHRINE_WEEKLY_MAINTENANCE_COST.toLocaleString()} tokens`,
      };
    }),
});
