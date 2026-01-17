import { z } from "zod";
import { nanoid } from "nanoid";
import { createTRPCRouter, protectedProcedure } from "@/api/trpc";
import { eq, and, ne, desc } from "drizzle-orm";
import {
  userData,
  activityStreakConfig,
  activityStreakReward,
  userStreakProgress,
  actionLog,
} from "@/drizzle/schema";
import { canChangeContent } from "@/utils/permissions";
import { isToday, isWithinDateRange, hoursSince } from "@/utils/time";
import {
  activityStreakConfigSchema,
  activityStreakConfigUpdateSchema,
  purchaseEventPassSchema,
  claimStreakDaySchema,
} from "@/validators/activityStreak";
import { baseServerResponse, errorResponse } from "@/api/trpc";
import { fetchUser } from "@/routers/profile";
import { updateRewards } from "@/server/api/routers/quests";
import { postProcessRewards } from "@/libs/quest";
import { getRewardPreview } from "@/libs/objectives";
import { ObjectiveReward } from "@/validators/objectives";
import type { DrizzleClient } from "@/server/db";
import type { ObjectiveRewardType } from "@/validators/objectives";

const STREAK_CONTINUITY_HOURS = 36;

const isStreakContinuous = (lastClaimDate: Date | null): boolean => {
  return hoursSince(lastClaimDate) < STREAK_CONTINUITY_HOURS;
};

const getDefaultRewards = (): ObjectiveRewardType => {
  return ObjectiveReward.parse({});
};

export const activityStreakRouter = createTRPCRouter({
  // ===== Player Endpoints =====

  // Get all user's active streaks (RECURRING + owned EVENT_PASSes)
  getUserStreaks: protectedProcedure.query(async ({ ctx }) => {
    // Get user's progress entries and active RECURRING config in parallel
    const [progressEntries, activeRecurring] = await Promise.all([
      ctx.drizzle.query.userStreakProgress.findMany({
        where: eq(userStreakProgress.userId, ctx.userId),
        with: {
          config: {
            with: {
              rewards: true,
            },
          },
        },
      }),
      ctx.drizzle.query.activityStreakConfig.findFirst({
        where: and(
          eq(activityStreakConfig.streakType, "RECURRING"),
          eq(activityStreakConfig.isActive, true),
        ),
        with: {
          rewards: true,
        },
      }),
    ]);

    // Check if user has progress for the active recurring config
    const hasRecurringProgress = progressEntries.some(
      (p) => p.config?.streakType === "RECURRING" && p.config.isActive,
    );

    // Build response
    const streaks = progressEntries
      .map((progress) => {
        const config = progress.config;
        if (!config) return null;

        const canClaimToday = !isToday(progress.lastClaimDate);
        const withinThreshold = isStreakContinuous(progress.lastClaimDate);

        // For RECURRING, if streak broken, will reset to day 1
        const effectiveDay =
          config.streakType === "RECURRING" &&
          !withinThreshold &&
          progress.currentDay > 0
            ? 0
            : progress.currentDay;

        const nextDayNumber = effectiveDay + 1;
        const nextReward = config.rewards.find((r) => r.dayNumber === nextDayNumber);

        return {
          progressId: progress.id,
          configId: config.id,
          configName: config.name,
          configImage: config.image,
          streakType: config.streakType,
          totalDays: config.totalDays,
          currentDay: effectiveDay,
          nextDayNumber,
          canClaimToday,
          alreadyClaimedToday: isToday(progress.lastClaimDate),
          streakWillReset:
            config.streakType === "RECURRING" &&
            !withinThreshold &&
            progress.currentDay > 0,
          nextRewards: nextReward?.rewards ?? null,
          allRewards: config.rewards.sort((a, b) => a.dayNumber - b.dayNumber),
          startedAt: progress.startedAt,
          lastClaimDate: progress.lastClaimDate,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    return {
      streaks,
      // Include info about active recurring for UI to show the streak calendar
      // even before the user has claimed their first day
      activeRecurringConfig:
        activeRecurring && !hasRecurringProgress
          ? {
              id: activeRecurring.id,
              name: activeRecurring.name,
              image: activeRecurring.image,
              totalDays: activeRecurring.totalDays,
              rewards: activeRecurring.rewards.sort(
                (a, b) => a.dayNumber - b.dayNumber,
              ),
            }
          : null,
    };
  }),

  // Get purchasable EVENT_PASSes (active, within date range, not owned)
  getAvailablePasses: protectedProcedure.query(async ({ ctx }) => {
    // Get all active EVENT_PASS configs and user's progress in parallel
    const [eventPasses, userProgress] = await Promise.all([
      ctx.drizzle.query.activityStreakConfig.findMany({
        where: and(
          eq(activityStreakConfig.streakType, "EVENT_PASS"),
          eq(activityStreakConfig.isActive, true),
        ),
        with: {
          rewards: true,
        },
      }),
      ctx.drizzle.query.userStreakProgress.findMany({
        where: eq(userStreakProgress.userId, ctx.userId),
        columns: { configId: true },
      }),
    ]);

    const ownedConfigIds = new Set(userProgress.map((p) => p.configId));

    // Filter to only available passes
    const availablePasses = eventPasses
      .filter((config) => {
        // Not already owned
        if (ownedConfigIds.has(config.id)) return false;

        // Within date range
        if (!isWithinDateRange(config.startDate, config.endDate)) return false;

        return true;
      })
      .map((config) => ({
        id: config.id,
        name: config.name,
        description: config.description,
        image: config.image,
        totalDays: config.totalDays,
        ryoCost: config.ryoCost,
        repsCost: config.repsCost,
        seichiSilverCost: config.seichiSilverCost,
        startDate: config.startDate,
        endDate: config.endDate,
        rewards: config.rewards.sort((a, b) => a.dayNumber - b.dayNumber),
      }));

    return availablePasses;
  }),

  // Purchase an EVENT_PASS
  purchaseEventPass: protectedProcedure
    .input(purchaseEventPassSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch user, config, and existing progress in parallel
      const [user, config, existingProgress] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.activityStreakConfig.findFirst({
          where: eq(activityStreakConfig.id, input.configId),
        }),
        ctx.drizzle.query.userStreakProgress.findFirst({
          where: and(
            eq(userStreakProgress.userId, ctx.userId),
            eq(userStreakProgress.configId, input.configId),
          ),
        }),
      ]);

      // Guard: config exists
      if (!config) {
        return errorResponse("Event pass not found");
      }

      // Guard: is EVENT_PASS type
      if (config.streakType !== "EVENT_PASS") {
        return errorResponse("This is not an event pass");
      }

      // Guard: is active
      if (!config.isActive) {
        return errorResponse("This event pass is not currently available");
      }

      // Guard: within date range
      if (!isWithinDateRange(config.startDate, config.endDate)) {
        return errorResponse("This event pass is not available at this time");
      }

      // Guard: user doesn't already own it
      if (existingProgress) {
        return errorResponse("You already own this event pass");
      }

      // Guard: user has sufficient currency
      if (config.ryoCost > 0 && user.money < config.ryoCost) {
        return errorResponse(
          `Not enough ryo. Required: ${config.ryoCost}, Available: ${Math.floor(user.money)}`,
        );
      }
      if (config.repsCost > 0 && user.reputationPoints < config.repsCost) {
        return errorResponse(
          `Not enough reputation points. Required: ${config.repsCost}, Available: ${Math.floor(user.reputationPoints)}`,
        );
      }
      if (config.seichiSilverCost > 0 && user.seichiSilver < config.seichiSilverCost) {
        return errorResponse(
          `Not enough seichi silver. Required: ${config.seichiSilverCost}, Available: ${user.seichiSilver}`,
        );
      }

      // Deduct currency and create progress
      await Promise.all([
        ctx.drizzle
          .update(userData)
          .set({
            money: user.money - config.ryoCost,
            reputationPoints: user.reputationPoints - config.repsCost,
            seichiSilver: user.seichiSilver - config.seichiSilverCost,
          })
          .where(eq(userData.userId, ctx.userId)),
        ctx.drizzle.insert(userStreakProgress).values({
          id: nanoid(),
          userId: ctx.userId,
          configId: config.id,
          currentDay: 0,
          lastClaimDate: null,
          startedAt: new Date(),
        }),
      ]);

      // Build cost message
      const costs: string[] = [];
      if (config.ryoCost > 0) costs.push(`${config.ryoCost} ryo`);
      if (config.repsCost > 0) costs.push(`${config.repsCost} reputation`);
      if (config.seichiSilverCost > 0)
        costs.push(`${config.seichiSilverCost} seichi silver`);

      return {
        success: true,
        message: `Purchased "${config.name}" for ${costs.join(", ")}!`,
      };
    }),

  // Claim daily reward for a specific config
  claimStreakDay: protectedProcedure
    .input(claimStreakDaySchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch user, config, and progress in parallel
      const [user, config, existingProgress] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.activityStreakConfig.findFirst({
          where: eq(activityStreakConfig.id, input.configId),
          with: { rewards: true },
        }),
        ctx.drizzle.query.userStreakProgress.findFirst({
          where: and(
            eq(userStreakProgress.userId, ctx.userId),
            eq(userStreakProgress.configId, input.configId),
          ),
        }),
      ]);

      // Guard: config exists
      if (!config) {
        return errorResponse("Streak configuration not found");
      }

      // Guard: config is active
      if (!config.isActive) {
        return errorResponse("This streak is not currently active");
      }

      // Guard: EVENT_PASS must be within date range
      if (
        config.streakType === "EVENT_PASS" &&
        !isWithinDateRange(config.startDate, config.endDate)
      ) {
        return errorResponse("This event pass has expired");
      }

      // Get or create progress entry
      let progress = existingProgress;

      // For RECURRING: auto-create progress if doesn't exist
      if (!progress && config.streakType === "RECURRING") {
        const newProgressId = nanoid();
        await ctx.drizzle.insert(userStreakProgress).values({
          id: newProgressId,
          userId: ctx.userId,
          configId: config.id,
          currentDay: 0,
          lastClaimDate: null,
          startedAt: new Date(),
        });
        progress = {
          id: newProgressId,
          userId: ctx.userId,
          configId: config.id,
          currentDay: 0,
          lastClaimDate: null,
          startedAt: new Date(),
        };
      }

      // Guard: must have progress (for EVENT_PASS, means must be purchased)
      if (!progress) {
        return errorResponse("You need to purchase this event pass first");
      }

      // Guard: not already claimed today
      if (isToday(progress.lastClaimDate)) {
        return errorResponse("You have already claimed this streak today");
      }

      // Calculate new day number
      let newCurrentDay: number;
      let streakReset = false;

      if (config.streakType === "RECURRING") {
        // RECURRING: check continuity, reset if broken
        const continuous = isStreakContinuous(progress.lastClaimDate);
        if (continuous || progress.currentDay === 0) {
          newCurrentDay = progress.currentDay + 1;
        } else {
          // Streak broken, reset to day 1
          newCurrentDay = 1;
          streakReset = true;
        }
      } else {
        // EVENT_PASS: simple increment
        newCurrentDay = progress.currentDay + 1;
      }

      // Get rewards for this day
      const dayReward = config.rewards.find((r) => r.dayNumber === newCurrentDay);
      const rewards = dayReward?.rewards ?? getDefaultRewards();
      const now = new Date();

      // Check if this completes the streak
      const isComplete = newCurrentDay >= config.totalDays;

      // Apply rewards and update progress
      const processedRewards = postProcessRewards(rewards);

      const updatePromises: Promise<unknown>[] = [
        updateRewards({
          client: ctx.drizzle,
          user,
          rewards: processedRewards,
          reason: `ACTIVITY_STREAK_${config.streakType}`,
        }),
      ];

      if (isComplete) {
        // Streak complete - log to actionLog and delete progress
        updatePromises.push(
          ctx.drizzle.insert(actionLog).values({
            id: nanoid(),
            userId: ctx.userId,
            tableName: "activityStreak",
            changes: [`Completed ${config.name} (${config.streakType})`],
            relatedId: config.id,
            relatedMsg: `Streak completed: ${config.name}`,
            relatedImage: config.image,
          }),
        );
        updatePromises.push(
          ctx.drizzle
            .delete(userStreakProgress)
            .where(eq(userStreakProgress.id, progress.id)),
        );
      } else {
        // Update progress
        updatePromises.push(
          ctx.drizzle
            .update(userStreakProgress)
            .set({
              currentDay: newCurrentDay,
              lastClaimDate: now,
            })
            .where(eq(userStreakProgress.id, progress.id)),
        );
      }

      await Promise.all(updatePromises);

      // Build response message
      const rewardPreview = getRewardPreview(rewards);
      const rewardText = rewardPreview
        ? `Rewards: ${rewardPreview}`
        : "Streak claimed!";
      const resetMsg = streakReset ? "(Streak reset) " : "";
      const completeMsg = isComplete ? " Streak completed!" : "";

      return {
        success: true,
        message: `Day ${newCurrentDay} claimed! ${resetMsg}${rewardText}${completeMsg}`,
      };
    }),

  // ===== Admin/Content Endpoints =====

  // Get all streak configurations
  getConfigs: protectedProcedure
    .input(
      z
        .object({
          streakType: z.enum(["RECURRING", "EVENT_PASS"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const whereClause = input?.streakType
        ? eq(activityStreakConfig.streakType, input.streakType)
        : undefined;

      const configs = await ctx.drizzle.query.activityStreakConfig.findMany({
        where: whereClause,
        orderBy: [desc(activityStreakConfig.createdAt)],
        with: {
          rewards: true,
        },
      });
      return configs;
    }),

  // Get single config with rewards
  getConfig: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const config = await ctx.drizzle.query.activityStreakConfig.findFirst({
        where: eq(activityStreakConfig.id, input.id),
        with: {
          rewards: {
            orderBy: [activityStreakReward.dayNumber],
          },
        },
      });
      return config;
    }),

  // Create new streak configuration
  createConfig: protectedProcedure
    .input(activityStreakConfigSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch user and check for existing RECURRING
      const [user, existingRecurring] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.activityStreakConfig.findFirst({
          where: eq(activityStreakConfig.streakType, "RECURRING"),
        }),
      ]);

      // Guard: permission check
      if (!canChangeContent(user.role)) {
        return errorResponse(
          "You don't have permission to create streak configurations",
        );
      }

      // Guard: prevent multiple RECURRING configs
      if (input.streakType === "RECURRING" && existingRecurring) {
        return errorResponse(
          "A RECURRING streak configuration already exists. Only one RECURRING config is allowed.",
        );
      }

      // Create config
      const configId = nanoid();
      await ctx.drizzle.insert(activityStreakConfig).values({
        id: configId,
        name: input.name,
        description: input.description ?? null,
        image: input.image ?? null,
        totalDays: input.totalDays,
        streakType: input.streakType,
        isActive: input.isActive,
        ryoCost: input.ryoCost,
        repsCost: input.repsCost,
        seichiSilverCost: input.seichiSilverCost,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        createdByUserId: ctx.userId,
      });

      // Create rewards for each day
      if (input.rewards.length > 0) {
        await createRewardsForConfig(ctx.drizzle, configId, input.rewards);
      }

      return { success: true, message: configId };
    }),

  // Update existing configuration
  updateConfig: protectedProcedure
    .input(activityStreakConfigUpdateSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch user, existing config, and check for other RECURRING configs
      const [user, existingConfig, existingRecurring] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.activityStreakConfig.findFirst({
          where: eq(activityStreakConfig.id, input.id),
        }),
        ctx.drizzle.query.activityStreakConfig.findFirst({
          where: and(
            eq(activityStreakConfig.streakType, "RECURRING"),
            ne(activityStreakConfig.id, input.id),
          ),
        }),
      ]);

      // Guard: permission check
      if (!canChangeContent(user.role)) {
        return errorResponse(
          "You don't have permission to update streak configurations",
        );
      }

      // Guard: config exists
      if (!existingConfig) {
        return errorResponse("Configuration not found");
      }

      // Guard: prevent multiple RECURRING configs
      if (input.streakType === "RECURRING" && existingRecurring) {
        return errorResponse(
          "A RECURRING streak configuration already exists. Only one RECURRING config is allowed.",
        );
      }

      // Update config and delete existing rewards in parallel
      await Promise.all([
        ctx.drizzle
          .update(activityStreakConfig)
          .set({
            name: input.name,
            description: input.description ?? null,
            image: input.image ?? null,
            totalDays: input.totalDays,
            streakType: input.streakType,
            isActive: input.isActive,
            ryoCost: input.ryoCost,
            repsCost: input.repsCost,
            seichiSilverCost: input.seichiSilverCost,
            startDate: input.startDate ?? null,
            endDate: input.endDate ?? null,
            updatedAt: new Date(),
          })
          .where(eq(activityStreakConfig.id, input.id)),
        ctx.drizzle
          .delete(activityStreakReward)
          .where(eq(activityStreakReward.configId, input.id)),
      ]);

      // Recreate rewards
      if (input.rewards.length > 0) {
        await createRewardsForConfig(ctx.drizzle, input.id, input.rewards);
      }

      return { success: true, message: "Configuration updated successfully" };
    }),

  // Delete configuration
  deleteConfig: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch user
      const user = await fetchUser(ctx.drizzle, ctx.userId);

      // Guard: permission check
      if (!canChangeContent(user.role)) {
        return errorResponse(
          "You don't have permission to delete streak configurations",
        );
      }

      // Delete rewards and progress first, then config
      await Promise.all([
        ctx.drizzle
          .delete(activityStreakReward)
          .where(eq(activityStreakReward.configId, input.id)),
        ctx.drizzle
          .delete(userStreakProgress)
          .where(eq(userStreakProgress.configId, input.id)),
      ]);
      await ctx.drizzle
        .delete(activityStreakConfig)
        .where(eq(activityStreakConfig.id, input.id));

      return { success: true, message: "Configuration deleted successfully" };
    }),

  // Toggle config active status
  toggleConfigActive: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch user and config
      const [user, config] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.activityStreakConfig.findFirst({
          where: eq(activityStreakConfig.id, input.id),
        }),
      ]);

      // Guard: permission check
      if (!canChangeContent(user.role)) {
        return errorResponse(
          "You don't have permission to modify streak configurations",
        );
      }

      if (!config) {
        return errorResponse("Configuration not found");
      }

      // If activating a RECURRING config, deactivate all other RECURRING configs
      if (!config.isActive && config.streakType === "RECURRING") {
        await ctx.drizzle
          .update(activityStreakConfig)
          .set({ isActive: false, updatedAt: new Date() })
          .where(
            and(
              eq(activityStreakConfig.streakType, "RECURRING"),
              eq(activityStreakConfig.isActive, true),
              ne(activityStreakConfig.id, input.id),
            ),
          );
      }

      // Toggle this config
      await ctx.drizzle
        .update(activityStreakConfig)
        .set({ isActive: !config.isActive, updatedAt: new Date() })
        .where(eq(activityStreakConfig.id, input.id));

      return {
        success: true,
        message: `Configuration ${config.isActive ? "deactivated" : "activated"} successfully`,
      };
    }),
});

// Helper function to create rewards for a config
const createRewardsForConfig = async (
  client: DrizzleClient,
  configId: string,
  rewards: Array<{
    dayNumber: number;
    rewards: ObjectiveRewardType;
    image?: string | null;
  }>,
) => {
  await client.insert(activityStreakReward).values(
    rewards.map((reward) => ({
      id: nanoid(),
      configId,
      dayNumber: reward.dayNumber,
      rewards: reward.rewards,
      image: reward.image ?? null,
    })),
  );
};
