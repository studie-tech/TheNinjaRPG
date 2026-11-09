import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  getClaimedStreakUpdate,
  getClaimStreakDayUserUpdate,
  getPurchaseEventPassUserUpdate,
} from "@/deltas/activityStreak";

import { ActivityStreakTypes, COST_STREAK_CATCHUP_DAY } from "@/drizzle/constants";
import { activityStreakConfig } from "@/drizzle/schema";
import {
  formatEventPassCost,
  getEventPassCompletionDate,
  getStreakClaimState,
  isEventPassCompletion,
  normalizeRecurringStreakProgress,
  resolveStreakClaim,
} from "@/libs/activityStreak";
import { getRewardPreview } from "@/libs/objectives";
import { postProcessRewards } from "@/libs/quest/rewards";

import {
  createRewardsForConfig,
  deleteActivityStreakConfigForDeleteConfig,
  deleteActivityStreakRewardForUpdateConfig,
  deleteUserStreakProgressForDeleteConfig,
  findActivityStreakConfigById,
  findActivityStreakConfigForClaimStreakDay,
  findActivityStreakConfigForGetConfig,
  findActivityStreakConfigForGetUserStreaks,
  findUserStreakProgress,
  insertActionLogForClaimStreakDay,
  insertActivityStreakConfigForCreateConfig,
  insertUserStreakProgressForClaimStreakDay,
  insertUserStreakProgressForPurchaseEventPass,
  listActionLogForClaimStreakDay,
  listActionLogForGetAvailablePasses,
  listActionLogForGetUserStreaks,
  listActionLogForPurchaseEventPass,
  listActivityStreakConfigForGetAvailablePasses,
  listActivityStreakConfigForGetConfigs,
  listUserStreakProgressForGetAvailablePasses,
  listUserStreakProgressForGetUserStreaks,
  updateActivityStreakConfigForUpdateConfig,
  updateUserDataForClaimStreakDay,
  updateUserDataForPurchaseEventPass,
  updateUserDataForPurchaseEventPass2,
  updateUserStreakProgressForClaimStreakDay,
  updateUserStreakProgressForClaimStreakDay2,
  updateUserStreakProgressForClaimStreakDay3,
} from "@/queries/activityStreak";
import { fetchUser } from "@/queries/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
} from "@/server/api/trpc";
import { isMysqlDuplicateKeyError } from "@/server/utils/mysqlErrors";
import { updateRewards } from "@/server/utils/questRewards";
import { validateTitleRewardIds } from "@/server/utils/titleRewards";
import { canChangeContent } from "@/utils/permissions";
import { isWithinDateRange } from "@/utils/time";
import {
  activityStreakConfigSchema,
  activityStreakConfigUpdateSchema,
  claimStreakDaySchema,
} from "@/validators/activityStreak";
import { idSchema } from "@/validators/misc";
import { ObjectiveReward, type ObjectiveRewardType } from "@/validators/rewards";
import { userDeltaResponseSchema } from "@/validators/userCache";

// Schema for purchasing an event pass
const purchaseEventPassSchema = z.object({
  configId: z.string(),
});

export const activityStreakRouter = createTRPCRouter({
  // ===== Player Endpoints =====

  // Get all user's active streaks (RECURRING + in-progress EVENT_PASSes)
  getUserStreaks: protectedProcedure
    .meta({ mcp: { description: "Get user's active activity streaks" } })
    .query(async ({ ctx }) => {
      // Get user's progress entries and active RECURRING config in parallel
      const [progressEntries, activeRecurring, completionLogs] = await Promise.all([
        listUserStreakProgressForGetUserStreaks(ctx.drizzle, ctx),
        findActivityStreakConfigForGetUserStreaks(ctx.drizzle),
        listActionLogForGetUserStreaks(ctx.drizzle, ctx),
      ]);

      const now = new Date();

      // Check if user has progress for the active recurring config
      const hasRecurringProgress = progressEntries.some(
        (p) => p.config?.streakType === "RECURRING" && p.config.isActive,
      );

      // Build response - filter out deactivated configs to avoid showing claimable streaks that can't actually be claimed
      const streaks = progressEntries
        .map((entry) => {
          const config = entry.config;
          if (!config) return null;
          const eventPassCompletedAt = getEventPassCompletionDate(
            completionLogs.filter((log) => log.relatedId === config.id),
          );
          const progress = normalizeRecurringStreakProgress(
            entry,
            config,
            now,
            eventPassCompletedAt,
          );

          // Skip deactivated configs - users cannot claim these
          if (!config.isActive) return null;

          const {
            isPassCompleted,
            theoreticalMaxDay,
            alreadyClaimedToday,
            continuous,
            isBehind,
          } = getStreakClaimState(progress, config, now, eventPassCompletedAt);

          // Completed event passes remain as permanent purchase records, but they
          // are no longer active streaks that the player can claim.
          if (isPassCompleted) return null;

          // Streak is broken if outside the 36-hour window (but user has progress)
          const streakBroken = !continuous && progress.currentDay > 0;

          // User needs to catch up if they're behind AND either:
          // - Their streak is broken (missed 36hr window), OR
          // - They've already claimed today (actively catching up)
          const needsCatchUp = isBehind && (streakBroken || alreadyClaimedToday);

          // Calculate days remaining to catch up
          const daysToGo = needsCatchUp
            ? Math.max(0, theoreticalMaxDay - progress.currentDay)
            : 0;

          // Can claim normally if not already claimed today and streak not broken
          const canClaimToday = !alreadyClaimedToday && !streakBroken;

          // Next day number is always currentDay + 1 (user continues from where they are)
          const nextDayNumber = progress.currentDay + 1;
          const nextReward = config.rewards.find((r) => r.dayNumber === nextDayNumber);

          return {
            progressId: progress.id,
            configId: config.id,
            configName: config.name,
            configImage: config.image,
            streakType: config.streakType,
            totalDays: config.totalDays,
            currentDay: progress.currentDay,
            theoreticalMaxDay,
            daysToGo,
            nextDayNumber,
            canClaimToday,
            alreadyClaimedToday,
            needsCatchUp,
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

  // Get purchasable EVENT_PASSes (active, within date range, never purchased)
  getAvailablePasses: protectedProcedure
    .meta({
      mcp: { description: "Get available event passes for purchase" },
    })
    .query(async ({ ctx }) => {
      // Completion audit entries also prove ownership when no progress row exists.
      const [eventPasses, userProgress, completionLogs] = await Promise.all([
        listActivityStreakConfigForGetAvailablePasses(ctx.drizzle),
        listUserStreakProgressForGetAvailablePasses(ctx.drizzle, ctx),
        listActionLogForGetAvailablePasses(ctx.drizzle, ctx),
      ]);

      const purchasedConfigIds = new Set(userProgress.map((p) => p.configId));
      for (const log of completionLogs) {
        if (log.relatedId && isEventPassCompletion(log.changes)) {
          purchasedConfigIds.add(log.relatedId);
        }
      }

      // Filter to only available passes
      const availablePasses = eventPasses
        .filter((config) => {
          // Event passes can only ever be purchased once.
          if (purchasedConfigIds.has(config.id)) return false;

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
    .meta({ mcp: { description: "Purchase an event pass" } })
    .input(purchaseEventPassSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch purchase requirements and both current and historical ownership in parallel.
      const [user, config, existingProgress, completionLogs] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findActivityStreakConfigById(ctx.drizzle, input.configId),
        findUserStreakProgress(ctx.drizzle, ctx.userId, input.configId),
        listActionLogForPurchaseEventPass(ctx.drizzle, ctx, input),
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

      // Guard: current progress and historical completions both prove the pass
      // was already purchased. Completion must never make it purchasable again.
      if (
        existingProgress ||
        completionLogs.some((log) => isEventPassCompletion(log.changes))
      ) {
        return errorResponse("You have already purchased this event pass");
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

      // Deduct currency atomically using DB-side arithmetic to prevent lost updates
      const updateResult = await updateUserDataForPurchaseEventPass(
        ctx.drizzle,
        config,
        ctx,
      );

      if (updateResult.rowsAffected === 0) {
        return errorResponse("Not enough currency to purchase this event pass");
      }

      // Create progress entry. A concurrent purchase may have won the unique-index
      // race after the currency was deducted, so refund rather than charging for a
      // pass this caller never received.
      const insertResult = await insertUserStreakProgressForPurchaseEventPass(
        ctx.drizzle,
        ctx,
        config,
      );

      if (insertResult.rowsAffected === 0) {
        await updateUserDataForPurchaseEventPass2(ctx.drizzle, config, ctx);
        return errorResponse("You have already purchased this event pass");
      }

      // Build cost message
      const costText = formatEventPassCost(config, {
        separator: ", ",
        silverLabel: "seichi silver",
        free: "free",
      });
      return {
        success: true,
        message: `Purchased "${config.name}" for ${costText}!`,
        ...getPurchaseEventPassUserUpdate({
          user,
          configRyoCost: config.ryoCost,
          configRepsCost: config.repsCost,
          configSeichiSilverCost: config.seichiSilverCost,
        }),
      };
    }),

  // Claim daily reward for a specific config
  claimStreakDay: protectedProcedure
    .meta({ mcp: { description: "Claim daily streak reward" } })
    .input(claimStreakDaySchema)
    .output(
      userDeltaResponseSchema.extend({
        streakUpdate: z
          .object({
            claimedAt: z.date(),
            configId: z.string(),
            progressId: z.string(),
            totalDays: z.number(),
            streakType: z.enum(ActivityStreakTypes),
            before: z.object({
              currentDay: z.number(),
              startedAt: z.date(),
              lastClaimDate: z.date().nullable(),
            }),
            after: z
              .object({
                currentDay: z.number(),
                startedAt: z.date(),
                lastClaimDate: z.date(),
                theoreticalMaxDay: z.number(),
                needsCatchUp: z.boolean(),
                nextDayNumber: z.number(),
                daysToGo: z.number(),
                alreadyClaimedToday: z.boolean(),
                canClaimToday: z.boolean(),
                nextRewards: z.custom<ObjectiveRewardType>().nullable(),
              })
              .nullable(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch user, config, and progress in parallel
      const [user, config, existingProgress, completionLogs] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findActivityStreakConfigForClaimStreakDay(ctx.drizzle, input),
        findUserStreakProgress(ctx.drizzle, ctx.userId, input.configId),
        listActionLogForClaimStreakDay(ctx.drizzle, ctx, input),
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
      const now = new Date();
      const eventPassCompletedAt = getEventPassCompletionDate(completionLogs);
      let progress = existingProgress
        ? normalizeRecurringStreakProgress(
            existingProgress,
            config,
            now,
            eventPassCompletedAt,
          )
        : undefined;
      const normalizedCompletion = !!existingProgress && progress !== existingProgress;

      // Successful creation already supplies the progress snapshot. Only a duplicate
      // first claim needs the winning row; lastClaimDate still guards the payout.
      if (!progress && config.streakType === "RECURRING") {
        const createdProgress = {
          id: nanoid(),
          userId: ctx.userId,
          configId: config.id,
          currentDay: 0,
          lastClaimDate: null,
          startedAt: now,
        };
        try {
          await insertUserStreakProgressForClaimStreakDay(ctx.drizzle, createdProgress);
          progress = createdProgress;
        } catch (error) {
          if (!isMysqlDuplicateKeyError(error)) throw error;
          progress = await findUserStreakProgress(ctx.drizzle, ctx.userId, config.id);
        }
      }

      // Guard: must have progress (for EVENT_PASS, means must be purchased)
      if (!progress) {
        return errorResponse("You need to purchase this event pass first");
      }

      const claimState = getStreakClaimState(
        progress,
        config,
        now,
        eventPassCompletedAt,
      );

      // Completed event-pass progress is retained as the permanent purchase
      // record and cannot be claimed or restarted.
      if (claimState.isPassCompleted) {
        return errorResponse("This event pass has already been completed");
      }

      const claim = resolveStreakClaim(progress.currentDay, claimState, {
        reset: input.reset,
        payCatchUp: input.payCatchUp,
        reputationPoints: user.reputationPoints,
      });
      if ("error" in claim) return errorResponse(claim.error);
      const { newCurrentDay, streakReset, paidCatchUp } = claim;

      // Get rewards for this day
      const dayReward = config.rewards.find((r) => r.dayNumber === newCurrentDay);
      // Stored rewards can predate added fields; apply their schema defaults before payout.
      const rewards = ObjectiveReward.parse(dayReward?.rewards ?? {});
      // Check if this completes the streak
      const isComplete = newCurrentDay >= config.totalDays;

      // Optimistic concurrency guard: Update progress with lastClaimDate check to prevent double-claims
      // IMPORTANT: This must happen BEFORE the reputation deduction to prevent losing rep
      // without claiming the streak day in case of concurrent requests
      const progressUpdateResult = await updateUserStreakProgressForClaimStreakDay(
        ctx.drizzle,
        newCurrentDay,
        now,
        streakReset,
        normalizedCompletion,
        config,
        progress,
      );

      if (progressUpdateResult.rowsAffected === 0) {
        return errorResponse("You have already claimed this streak today");
      }

      // If paying for catchup, deduct reputation points after successful progress update
      if (paidCatchUp) {
        const repUpdateResult = await updateUserDataForClaimStreakDay(ctx.drizzle, ctx);

        if (repUpdateResult.rowsAffected === 0) {
          // Rollback the progress update since we couldn't deduct reputation
          await updateUserStreakProgressForClaimStreakDay2(
            ctx.drizzle,
            progress,
            streakReset,
          );
          return errorResponse("Not enough reputation points");
        }
      }

      // Only grant rewards after successful progress update
      const processedRewards = postProcessRewards(rewards, user);

      const updatePromises: Promise<unknown>[] = [
        updateRewards({
          client: ctx.drizzle,
          user,
          rewards: processedRewards,
          reason: `ACTIVITY_STREAK_${config.streakType}`,
        }),
      ];

      if (isComplete) {
        // Streak complete - log to actionLog
        updatePromises.push(insertActionLogForClaimStreakDay(ctx.drizzle, ctx, config));

        // EVENT_PASS progress stays on its final day as the permanent purchase record.
        if (config.streakType === "RECURRING") {
          // RECURRING: reset progress but preserve lastClaimDate to prevent same-day re-claim
          updatePromises.push(
            updateUserStreakProgressForClaimStreakDay3(ctx.drizzle, now, progress),
          );
        }
      }

      await Promise.all(updatePromises);

      // Build response message
      const rewardPreview = getRewardPreview({
        ...processedRewards,
        reward_items: rewards.reward_items,
      });
      const rewardText = rewardPreview
        ? `Rewards: ${rewardPreview}`
        : "Streak claimed!";
      const resetMsg = streakReset ? "(Streak reset) " : "";
      const catchUpMsg = paidCatchUp
        ? `(Paid ${COST_STREAK_CATCHUP_DAY} rep to continue) `
        : "";
      const completeMsg = isComplete ? " Streak completed!" : "";

      return {
        success: true,
        message: `Day ${newCurrentDay} claimed! ${resetMsg}${catchUpMsg}${rewardText}${completeMsg}`,
        // Scalar reward increments leave queued training and its recovery clock alone.
        // The shared cache revision guard reconciles any concurrently completed queue read.
        ...getClaimStreakDayUserUpdate({ processedRewards, paidCatchUp }),
        streakUpdate: getClaimedStreakUpdate(
          config,
          progress,
          newCurrentDay,
          now,
          streakReset ||
            normalizedCompletion ||
            (config.streakType === "RECURRING" && progress.currentDay === 0),
        ),
      };
    }),

  // ===== Admin/Content Endpoints =====

  // Get all streak configurations; public for the activity streak manual page
  getConfigs: publicProcedure
    .input(
      z
        .object({
          streakType: z.enum(ActivityStreakTypes).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const whereClause = input?.streakType
        ? eq(activityStreakConfig.streakType, input.streakType)
        : undefined;

      const configs = await listActivityStreakConfigForGetConfigs(
        ctx.drizzle,
        whereClause,
      );
      return configs;
    }),

  // Get single config with rewards
  getConfig: protectedProcedure.input(idSchema).query(async ({ ctx, input }) => {
    const config = await findActivityStreakConfigForGetConfig(ctx.drizzle, input);
    return config;
  }),

  // Create new streak configuration
  createConfig: protectedProcedure
    .input(activityStreakConfigSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch user
      const [user, titleError] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        validateTitleRewardIds(ctx.drizzle, input),
      ]);

      // Guard: permission check
      if (!canChangeContent(user.role)) {
        return errorResponse(
          "You don't have permission to create streak configurations",
        );
      }

      if (titleError) return errorResponse(titleError);
      // Create config
      const configId = nanoid();
      await insertActivityStreakConfigForCreateConfig(
        ctx.drizzle,
        configId,
        input,
        ctx,
      );

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
      // Fetch user and existing config
      const [user, existingConfig, titleError] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findActivityStreakConfigById(ctx.drizzle, input.id),
        validateTitleRewardIds(ctx.drizzle, input),
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

      if (titleError) return errorResponse(titleError);
      // Update config and delete existing rewards in parallel
      await Promise.all([
        updateActivityStreakConfigForUpdateConfig(ctx.drizzle, input),
        deleteActivityStreakRewardForUpdateConfig(ctx.drizzle, input),
      ]);

      // Recreate rewards
      if (input.rewards.length > 0) {
        await createRewardsForConfig(ctx.drizzle, input.id, input.rewards);
      }

      return { success: true, message: "Configuration updated successfully" };
    }),

  // Delete configuration
  deleteConfig: protectedProcedure
    .input(idSchema)
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
        deleteActivityStreakRewardForUpdateConfig(ctx.drizzle, input),
        deleteUserStreakProgressForDeleteConfig(ctx.drizzle, input),
      ]);
      await deleteActivityStreakConfigForDeleteConfig(ctx.drizzle, input);

      return { success: true, message: "Configuration deleted successfully" };
    }),
});

// Helper function to create rewards for a config
