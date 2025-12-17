import { z } from "zod";
import { randomUUID } from "crypto";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { baseServerResponse, errorResponse } from "../trpc";
import { eq, and, gte, sql, asc, lt, gt } from "drizzle-orm";
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
import { sector, village, userData, shrineBoostSchedule } from "@/drizzle/schema";
import { fetchUpdatedUser, fetchUser } from "@/routers/profile";
import { secondsFromDate } from "@/utils/time";

export const shrineRouter = createTRPCRouter({
  // Get all AI names
  getShrineAis: publicProcedure.query(async ({ ctx }) => {
    return await ctx.drizzle.query.userData.findMany({
      where: and(eq(userData.isAi, true), eq(userData.inShrines, true)),
      with: {
        jutsus: {
          columns: { level: true },
          with: { jutsu: { columns: { name: true } } },
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
      return await ctx.drizzle.query.sector.findMany({
        where: eq(sector.villageId, input.villageId),
      });
    }),

  // ✅ V1.5: Return schedule rows (active + queued) for UI
  getBoostSchedule: protectedProcedure
    .input(z.object({ villageId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });

      if (!user?.villageId) return [];
      if (user.villageId !== input.villageId) return [];

      return await ctx.drizzle.query.shrineBoostSchedule.findMany({
        where: eq(shrineBoostSchedule.villageId, input.villageId),
        orderBy: asc(shrineBoostSchedule.startAt),
      });
    }),

    // ✅ Combined state for UI: active boosts + queued schedules
getBoostState: protectedProcedure
  .input(z.object({ villageId: z.string() }))
  .query(async ({ ctx, input }) => {
    const { user } = await fetchUpdatedUser({
      client: ctx.drizzle,
      userId: ctx.userId,
    });

    if (!user?.villageId || !user.village || user.villageId !== input.villageId) {
      return {
        activeBoosts: {},
        schedules: [],
      };
    }

    const schedules = await ctx.drizzle.query.shrineBoostSchedule.findMany({
      where: eq(shrineBoostSchedule.villageId, input.villageId),
      orderBy: asc(shrineBoostSchedule.startAt),
    });

    return {
      activeBoosts: user.village.shrineSettings.activeBoosts || {},
      schedules,
    };
  }),

  // Upgrade a shrine level (simplified version)
  upgradeShrine: protectedProcedure
    .input(z.object({ sectorNumber: z.number() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [{ user }, targetSector] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        ctx.drizzle.query.sector.findFirst({
          where: eq(sector.sector, input.sectorNumber),
        }),
      ]);

      if (!user?.villageId) return errorResponse("You must be in a village");
      if (!targetSector) return errorResponse("Sector not found");
      if (targetSector.villageId !== user.villageId)
        return errorResponse("You can only upgrade your own shrines");
      if (targetSector.shrineLevel >= SHRINE_MAX_LEVEL)
        return errorResponse(`Shrine level cannot exceed ${SHRINE_MAX_LEVEL}`);
      if (user?.village?.kageId !== user.userId)
        return errorResponse("Only the Kage can upgrade shrines");
      if (user?.village?.tokens < SHRINE_UPGRADE_COST)
        return errorResponse(
          `Need ${SHRINE_UPGRADE_COST.toLocaleString()} tokens to upgrade shrine`,
        );

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

  // ✅ Schedule a boost (supports weeks ahead + queueing)
  scheduleBoost: protectedProcedure
    .input(
      z.object({
        boostType: z.enum(SHRINE_BOOST_TYPES),
        villageId: z.string(),
        // allow scheduling ahead; if omitted, we schedule "now"
        startAt: z.date().optional(),
        endAt: z.date().optional(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      const [{ user }, level3Shrines] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        ctx.drizzle.query.sector.findMany({
          where: and(eq(sector.villageId, input.villageId), eq(sector.shrineLevel, 3)),
        }),
      ]);

      // Guards
      if (!user?.villageId) return errorResponse("You must be in a village");
      if (user.villageId !== input.villageId)
        return errorResponse("You can only schedule boosts for your own village");
      if (!user.village) return errorResponse("Village not found");
      if (user.village.kageId !== user.userId)
        return errorResponse("Only the Kage can schedule boosts");
      if (level3Shrines.length === 0)
        return errorResponse("Need at least one Level 3 shrine to activate boosts");
      if (user.village.tokens < SHRINE_BOOST_COST)
        return errorResponse(
          `Need ${SHRINE_BOOST_COST.toLocaleString()} tokens to activate boosts`,
        );

      // Compute window
      const startAt = input.startAt ?? now;

      // If endAt not provided, use fixed duration
      const endAt =
        input.endAt ??
        secondsFromDate(SHRINE_BOOST_DURATION_HOURS * 60 * 60, startAt);

      if (startAt >= endAt) {
        return errorResponse("Start time must be before end time");
      }

      // Overlap protection (same village + boostType)
      // overlap if existing.startAt < newEnd AND existing.endAt > newStart
      const overlap = await ctx.drizzle.query.shrineBoostSchedule.findFirst({
        where: and(
          eq(shrineBoostSchedule.villageId, input.villageId),
          eq(shrineBoostSchedule.boostType, input.boostType),
          lt(shrineBoostSchedule.startAt, endAt),
          gt(shrineBoostSchedule.endAt, startAt),
        ),
      });

      if (overlap) {
        return errorResponse(
          `${input.boostType} is already scheduled during that time window`,
        );
      }

      // Insert schedule row
      await ctx.drizzle.insert(shrineBoostSchedule).values({
        id: randomUUID(),
        villageId: input.villageId,
        boostType: input.boostType,
        startAt,
        endAt,
        createdByUserId: ctx.userId,
      });

      // Deduct tokens immediately (simple V1.5)
      // Optional: only deduct when it becomes active; but that requires more logic.
      await ctx.drizzle
        .update(village)
        .set({
          tokens: sql`${village.tokens} - ${SHRINE_BOOST_COST}`,
          // Instant UX: if active now, write activeBoosts immediately
          shrineSettings:
            startAt <= now && endAt > now
              ? {
                  ...user.village.shrineSettings,
                  activeBoosts: {
                    ...(user.village.shrineSettings.activeBoosts || {}),
                    [input.boostType]: endAt.toISOString(),
                  },
                }
              : user.village.shrineSettings,
        })
        .where(eq(village.id, user.villageId));

      const msg =
        startAt <= now && endAt > now
          ? `${input.boostType} boost scheduled and active now until ${endAt.toISOString()}`
          : `${input.boostType} boost scheduled from ${startAt.toISOString()} → ${endAt.toISOString()}`;

      return { success: true, message: msg };
    }),

    
  // ✅ V1.5: Cancel a scheduled boost (future or active)
  cancelBoost: protectedProcedure
    .input(z.object({ scheduleId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const schedule = await ctx.drizzle.query.shrineBoostSchedule.findFirst({
        where: eq(shrineBoostSchedule.id, input.scheduleId),
      });
      if (!schedule) return errorResponse("Schedule not found");

      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });

      if (!user?.villageId || user.villageId !== schedule.villageId) {
        return errorResponse("You can only cancel boosts for your own village");
      }
      if (!user.village || user.village.kageId !== user.userId) {
        return errorResponse("Only the Kage can cancel boosts");
      }

      await ctx.drizzle
        .delete(shrineBoostSchedule)
        .where(eq(shrineBoostSchedule.id, input.scheduleId));

      // If it was active now, remove cached activeBoosts ONLY if it matches this schedule's endAt
      const now = new Date();
      const isActiveNow = schedule.startAt <= now && schedule.endAt > now;

      if (isActiveNow) {
        const currentBoosts = user.village.shrineSettings.activeBoosts || {};
        const currentEndIso = currentBoosts[schedule.boostType];

        if (currentEndIso === schedule.endAt.toISOString()) {
          const { [schedule.boostType]: _removed, ...rest } = currentBoosts;

          await ctx.drizzle
            .update(village)
            .set({
              shrineSettings: {
                ...user.village.shrineSettings,
                activeBoosts: rest,
              },
            })
            .where(eq(village.id, user.villageId));
        }
      }

      return { success: true, message: "Boost schedule cancelled" };
    }),

  // Unlock AI defender type for village (Kage only)
  unlockAiDefender: protectedProcedure
    .input(z.object({ aiId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [{ user }, ai] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchUser(ctx.drizzle, input.aiId),
      ]);

      if (!user) return errorResponse("User not found");
      if (!user.village || !user.villageId) return errorResponse("You must be in a village");
      if (user.village.kageId !== user.userId)
        return errorResponse("Only the Kage can unlock AI defenders");
      if (user.village.tokens < SHRINE_AI_UNLOCK_COST)
        return errorResponse(
          `Need ${SHRINE_AI_UNLOCK_COST.toLocaleString()} tokens to unlock AI defender`,
        );
      if (!ai) return errorResponse("AI not found");

      const currentUnlocks = user.village.shrineSettings.unlockedAiIds || [];
      if (currentUnlocks.includes(input.aiId)) {
        return errorResponse("AI defender already unlocked");
      }

      const updatedUnlocks = [...currentUnlocks, input.aiId];

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
          and(eq(village.id, user.villageId), gte(village.tokens, SHRINE_AI_UNLOCK_COST)),
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
      const [{ user }, ai] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchUser(ctx.drizzle, input.aiId),
      ]);

      if (!user) return errorResponse("User not found");
      if (!user.village || !user.villageId) return errorResponse("You must be in a village");
      if (user.village.kageId !== user.userId)
        return errorResponse("Only the Kage can manage AI defenders");
      if (!ai) return errorResponse("AI not found");

      const currentUnlocks = user.village.shrineSettings.unlockedAiIds || [];
      const currentAssigns = user.village.shrineSettings.activeAiIds || [];

      if (!currentUnlocks.includes(input.aiId)) return errorResponse("AI defender not unlocked");

      let newAssigns: string[];
      let message: string;

      if (currentAssigns.includes(input.aiId)) {
        newAssigns = currentAssigns.filter((id) => id !== input.aiId);
        message = `AI defender ${ai.username} removed from active defenders`;
      } else {
        if (currentAssigns.length >= SHRINE_MAX_AI_ASSIGNMENTS) {
          return errorResponse(`Can only assign up to ${SHRINE_MAX_AI_ASSIGNMENTS} AI defenders`);
        }
        newAssigns = [...currentAssigns, input.aiId];
        message = `AI defender ${ai.username} added to active defenders`;
      }

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
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        ctx.drizzle.query.sector.findFirst({
          where: eq(sector.id, input.sectorId),
          with: { village: true },
        }),
      ]);

      if (!user) return errorResponse("User not found");
      if (!user.village || !user.villageId) return errorResponse("You must be in a village");
      if (!targetSector) return errorResponse("Sector not found");
      if (targetSector.villageId !== user.villageId)
        return errorResponse("You can only pay maintenance for your own village's sectors");
      if (user.village.kageId !== user.userId)
        return errorResponse("Only the Kage can pay shrine maintenance");
      if (user.village.tokens < SHRINE_WEEKLY_MAINTENANCE_COST)
        return errorResponse(
          `Need ${SHRINE_WEEKLY_MAINTENANCE_COST.toLocaleString()} tokens for maintenance`,
        );

      const currentNextMaintainanceDueDate = targetSector.nextMaintainanceDueDate || new Date();
      const nextNextMaintainanceDueDate = secondsFromDate(
        WAR_SHRINE_MAINTENANCE_DAYS * 24 * 60 * 60,
        currentNextMaintainanceDueDate,
      );

      await Promise.all([
        ctx.drizzle
          .update(village)
          .set({ tokens: sql`${village.tokens} - ${SHRINE_WEEKLY_MAINTENANCE_COST}` })
          .where(
            and(
              eq(village.id, user.villageId),
              gte(village.tokens, SHRINE_WEEKLY_MAINTENANCE_COST),
            ),
          ),
        ctx.drizzle
          .update(sector)
          .set({ nextMaintainanceDueDate: nextNextMaintainanceDueDate })
          .where(eq(sector.id, input.sectorId)),
      ]);

      return {
        success: true,
        message: `Weekly maintenance paid for sector ${targetSector.sector}: ${SHRINE_WEEKLY_MAINTENANCE_COST.toLocaleString()} tokens`,
      };
    }),
});
