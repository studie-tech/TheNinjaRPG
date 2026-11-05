import { getServerPusher, updateUserOnMap } from "@/libs/pusher";
import { getPvpBoost } from "@/libs/pvpExperience";
import { getTerritoryWarPeriodBoost } from "@/libs/territoryWar";
import {
  clearStealthForUsers,
  listUserDataForUseSensory,
  selectVillageAllianceForUseSensory,
  updateUserDataForActivateStealth,
  updateUserDataForCancelCovertTraining,
  updateUserDataForDeactivateStealth,
  updateUserDataForStopCovertTraining,
  updateUserDataForTrainCovert,
  updateUserDataForUseSensory,
} from "@/queries/stealth";
import { fetchUpdatedUser } from "@/routers/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import {
  actionReadinessResponse,
  prepareActionReadiness,
} from "@/server/utils/actionReadiness";
import { getAlliedVillageIds } from "@/utils/alliance";

const pusher = getServerPusher();

import type { CovertTrainingType } from "@/drizzle/constants";
import {
  STEALTH_SENSORY_CAP,
  STEALTH_TRAIN_GAIN_PER_MINUTE,
} from "@/drizzle/constants";
import {
  calcCovertTrainingGain,
  calcSensoryCooldown,
  calcStealthDuration,
  getRemainingSensoryCooldown,
  getRemainingStealthCooldown,
  isSensoryReady,
  isStealthCooldownExpired,
  isStealthExpired,
  rollSensoryDetection,
  rollStealthKeep,
} from "@/libs/stealth";
import {
  activateStealthDataSchema,
  startTrainDataSchema,
  stopTrainDataSchema,
  trainInputSchema,
  useSensoryDataSchema,
  useSensoryInputSchema,
} from "@/validators/stealth";

export const stealthRouter = createTRPCRouter({
  // Activate stealth mode
  activateStealth: protectedProcedure
    .meta({ mcp: { description: "Activate stealth mode" } })
    .output(
      baseServerResponse.extend({
        data: activateStealthDataSchema.optional(),
      }),
    )
    .mutation(async ({ ctx }) => {
      // Query
      let { user, settings } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });

      // Guard
      if (!user) return errorResponse("User not found");
      const readiness = prepareActionReadiness(user, settings);
      if (readiness.error) return errorResponse(readiness.error);
      user = readiness.user;

      // Clean up expired stealth before the "already active" guard
      if (
        user.stealthActive &&
        isStealthExpired(user.stealthActivatedAt, user.stealth)
      ) {
        user = { ...user, stealthActive: false, stealthActivatedAt: null };
      }

      if (user.stealthActive) return errorResponse("Stealth is already active");
      if (!isStealthCooldownExpired(user.stealthCooldownAt)) {
        const remaining = getRemainingStealthCooldown(user.stealthCooldownAt);
        return errorResponse(
          `Stealth is on cooldown for ${Math.ceil(remaining)} more seconds`,
        );
      }

      // Derived
      const stealthActivatedAt = new Date();

      // Mutation
      const result = await updateUserDataForActivateStealth(
        ctx.drizzle,
        stealthActivatedAt,
        ctx,
        readiness,
      );

      if (result.rowsAffected === 0) {
        return errorResponse("Failed to activate stealth");
      }

      // Broadcast with stealthActive: true so other clients remove this user from their map
      void broadcastStealth(user, true);

      const duration = calcStealthDuration(user.stealth);
      return actionReadinessResponse(
        {
          success: true,
          message: `Stealth activated for ${Math.floor(duration / 60)} minutes`,
          data: { stealthActivatedAt },
        },
        readiness,
        ctx.drizzle,
      );
    }),

  // Deactivate stealth mode
  deactivateStealth: protectedProcedure
    .meta({ mcp: { description: "Deactivate stealth mode" } })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Query
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });

      // Guard
      if (!user) return errorResponse("User not found");
      if (!user.stealthActive) return errorResponse("Stealth is not active");

      // Mutation
      const result = await updateUserDataForDeactivateStealth(ctx.drizzle, ctx);

      if (result.rowsAffected === 0) {
        return errorResponse("Stealth is not active");
      }

      // Broadcast with stealthActive: false so other clients show this user on their map
      void broadcastStealth(user, false);

      return { success: true, message: "Stealth deactivated" };
    }),

  // Use sensory to scan for stealthed enemies in the sector
  useSensory: protectedProcedure
    .meta({ mcp: { description: "Scan for stealthed users in sector" } })
    .input(useSensoryInputSchema)
    .output(
      baseServerResponse.extend({
        data: useSensoryDataSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query (parallel)
      let [{ user, settings }, stealthedUsers, alliances] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        listUserDataForUseSensory(ctx.drizzle, input, ctx),
        selectVillageAllianceForUseSensory(ctx.drizzle),
      ]);

      // Guard
      if (!user) return errorResponse("User not found");
      const readiness = prepareActionReadiness(user, settings);
      if (readiness.error) return errorResponse(readiness.error);
      user = readiness.user;
      if (user.sector !== input.sector)
        return errorResponse("You are not in this sector");
      if (!isSensoryReady(user.lastSensoryAt, user.sensory)) {
        const remaining = getRemainingSensoryCooldown(user.lastSensoryAt, user.sensory);
        return errorResponse(
          `Sensory is on cooldown for ${Math.ceil(remaining)} more seconds`,
        );
      }

      // Derived - get all allied village IDs (same village + formal allies)
      const alliedSet = new Set(getAlliedVillageIds(alliances, user.villageId));

      // Filter out allied users, then roll for detection
      const detectedUsers: (typeof stealthedUsers)[number][] = [];
      for (const stealthedUser of stealthedUsers) {
        // Skip allied users - sensory doesn't reveal allies
        if (stealthedUser.villageId && alliedSet.has(stealthedUser.villageId)) continue;
        if (rollSensoryDetection(user.sensory)) {
          detectedUsers.push(stealthedUser);
        }
      }
      const detectedUserIds = detectedUsers.map((u) => u.userId);
      const lastSensoryAt = new Date();

      // Claim availability and reveal targets together before broadcasting them.
      const result = await updateUserDataForUseSensory(
        ctx.drizzle,
        lastSensoryAt,
        ctx,
        readiness,
        detectedUserIds,
      );
      if (!result.rowsAffected)
        return errorResponse("Your status changed. Please try again.");

      // Broadcast map updates and notifications for detected users
      if (detectedUsers.length > 0) {
        const broadcasts = detectedUsers.flatMap((detectedUser) => [
          // Broadcast to sector so they appear on the map for everyone
          broadcastStealth(detectedUser, false),
          // Notify the detected user that their stealth was broken
          pusher.trigger(detectedUser.userId, "event", {
            type: "userMessage",
            message: `Your stealth was broken by ${user.username}'s sensory ability!`,
            route: "/travel",
          }),
        ]);
        void Promise.all(broadcasts);
      }

      const cooldown = calcSensoryCooldown(user.sensory);
      return actionReadinessResponse(
        {
          success: true,
          message:
            detectedUsers.length > 0
              ? `Revealed ${detectedUsers.length} stealthed player(s)!`
              : `No stealthed players detected. Next scan available in ${Math.floor(cooldown)} seconds`,
          data: {
            detectedUsers: detectedUsers.map((u) => ({
              userId: u.userId,
              username: u.username,
              longitude: u.longitude,
              latitude: u.latitude,
              villageId: u.villageId,
              level: u.level,
            })),
            lastSensoryAt,
          },
        },
        readiness,
        ctx.drizzle,
      );
    }),

  // Start covert training (stealth or sensory)
  trainCovert: protectedProcedure
    .meta({ mcp: { description: "Start stealth or sensory training" } })
    .input(trainInputSchema)
    .output(
      baseServerResponse.extend({
        data: startTrainDataSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query
      let { user, settings } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });

      // Guard
      if (!user) return errorResponse("User not found");
      const readiness = prepareActionReadiness(user, settings);
      if (readiness.error) return errorResponse(readiness.error);
      user = readiness.user;
      if (user.covertTrainingType) {
        return errorResponse("Already training covert skills");
      }

      // Derived
      const currentStat = input.type === "stealth" ? user.stealth : user.sensory;
      const statName = input.type === "stealth" ? "Stealth" : "Sensory";

      // Guard (stat-specific)
      if (currentStat >= STEALTH_SENSORY_CAP) {
        return errorResponse(`${statName} is already at maximum`);
      }

      // Derived
      const expectedGain = calcCovertTrainingGain(
        input.minutes,
        currentStat,
        STEALTH_SENSORY_CAP,
        STEALTH_TRAIN_GAIN_PER_MINUTE,
        getPvpBoost(user, settings).totalPercent,
        getTerritoryWarPeriodBoost(
          user,
          new Date(),
          new Date(Date.now() + input.minutes * 60000),
        ),
      );
      const finishAt = new Date(Date.now() + input.minutes * 60 * 1000);

      // Mutation
      const result = await updateUserDataForTrainCovert(
        ctx.drizzle,
        input,
        ctx,
        readiness,
      );

      if (result.rowsAffected === 0) {
        return errorResponse(`Failed to start ${input.type} training`);
      }

      return actionReadinessResponse(
        {
          success: true,
          message: `Started ${input.minutes} minute ${input.type} training`,
          data: {
            covertTrainingType: input.type as CovertTrainingType,
            covertTrainingFinishAt: finishAt,
            covertTrainingGain: expectedGain,
          },
        },
        readiness,
        ctx.drizzle,
      );
    }),

  // Stop covert training and collect rewards
  stopCovertTraining: protectedProcedure
    .meta({
      mcp: { description: "Stop covert training and collect rewards" },
    })
    .output(
      baseServerResponse.extend({
        data: stopTrainDataSchema.optional(),
      }),
    )
    .mutation(async ({ ctx }) => {
      // Query
      const { user, settings } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });

      // Guard
      if (!user) return errorResponse("User not found");
      if (!user.covertTrainingType)
        return errorResponse("Not currently training covert skills");
      if (!user.covertTrainingStartedAt || user.covertTrainingMinutes == null)
        return errorResponse("Training data is missing");

      // Derived
      const finishTime =
        user.covertTrainingStartedAt.getTime() + user.covertTrainingMinutes * 60 * 1000;

      // Guard
      if (Date.now() < finishTime) {
        return errorResponse("Training is not yet complete");
      }

      // Derived
      const currentStat =
        user.covertTrainingType === "stealth" ? user.stealth : user.sensory;
      const gained = calcCovertTrainingGain(
        user.covertTrainingMinutes,
        currentStat,
        STEALTH_SENSORY_CAP,
        STEALTH_TRAIN_GAIN_PER_MINUTE,
        getPvpBoost(user, settings).totalPercent,
        getTerritoryWarPeriodBoost(
          user,
          user.covertTrainingStartedAt,
          new Date(finishTime),
        ),
      );
      const newValue = Math.min(currentStat + gained, STEALTH_SENSORY_CAP);

      // Mutation
      const result = await updateUserDataForStopCovertTraining(
        ctx.drizzle,
        { covertTrainingType: user.covertTrainingType },
        gained,
        ctx,
      );

      if (result.rowsAffected === 0) {
        return errorResponse("Failed to complete training");
      }

      return {
        success: true,
        message: `Gained ${gained.toFixed(0)} ${user.covertTrainingType} points`,
        data: { gained, newValue },
      };
    }),

  // Cancel covert training without rewards
  cancelCovertTraining: protectedProcedure
    .meta({ mcp: { description: "Cancel covert training" } })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Mutation (with guard in WHERE clause)
      const result = await updateUserDataForCancelCovertTraining(ctx.drizzle, ctx);

      if (result.rowsAffected === 0) {
        return errorResponse("Not currently training covert skills");
      }

      return { success: true, message: "Training cancelled" };
    }),
});

/** Tell the sector whether a user is hidden; other clients add or drop them from the map. */
const broadcastStealth = (
  user: Omit<Parameters<typeof updateUserOnMap>[2], "stealthActive">,
  stealthActive: boolean,
) =>
  updateUserOnMap(pusher, user.sector, {
    userId: user.userId,
    sector: user.sector,
    longitude: user.longitude,
    latitude: user.latitude,
    location: user.location,
    villageId: user.villageId,
    battleId: user.battleId,
    level: user.level,
    experience: user.experience,
    rank: user.rank,
    status: user.status,
    stealthActive,
  });

/**
 * Break stealth for a user when stealth-breaking actions occur.
 * Used by other routers (e.g., combat, robbery) to reveal stealthed users.
 *
 * @param drizzle - Database client instance
 * @param userId - The user ID whose stealth should potentially be broken
 * @param stealthStat - The user's current stealth stat (used for roll calculation)
 * @param forceBreak - If true, always breaks stealth (e.g., when being attacked)
 * @returns Promise<boolean> - True if stealth was broken, false if maintained
 */
export const breakStealth = async (
  drizzle: Parameters<typeof fetchUpdatedUser>[0]["client"],
  userId: string,
  stealthStat: number,
  forceBreak: boolean = false,
): Promise<boolean> => {
  // If not forcing, roll to see if stealth is maintained
  if (!forceBreak && rollStealthKeep(stealthStat)) {
    return false;
  }

  // Break stealth
  await clearStealthForUsers(drizzle, [userId]);
  return true;
};
