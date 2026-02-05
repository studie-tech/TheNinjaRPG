import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { userData, villageAlliance } from "@/drizzle/schema";
import { getServerPusher, updateUserOnMap } from "@/libs/pusher";
import { fetchUpdatedUser } from "@/routers/profile";
import { secondsFromNow } from "@/utils/time";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "../trpc";

const pusher = getServerPusher();

import type { CovertTrainingType } from "@/drizzle/constants";
import {
  STEALTH_POST_COMBAT_COOLDOWN_SECONDS,
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
    .meta({ mcp: { enabled: true, description: "Activate stealth mode" } })
    .output(
      baseServerResponse.extend({
        data: activateStealthDataSchema.optional(),
      }),
    )
    .mutation(async ({ ctx }) => {
      // Query
      let { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });

      // Guard
      if (!user) throw serverError("NOT_FOUND", "User not found");
      if (user.status !== "AWAKE")
        return errorResponse("Must be awake to activate stealth");

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
      const result = await ctx.drizzle
        .update(userData)
        .set({
          stealthActive: true,
          stealthActivatedAt,
        })
        .where(eq(userData.userId, ctx.userId));

      if (result.rowsAffected === 0) {
        return errorResponse("Failed to activate stealth");
      }

      // Broadcast with stealthActive: true so other clients remove this user from their map
      void updateUserOnMap(pusher, user.sector, {
        userId: user.userId,
        sector: user.sector,
        longitude: user.longitude,
        latitude: user.latitude,
        username: user.username,
        avatar: user.avatar,
        avatarLight: user.avatarLight,
        location: user.location,
        villageId: user.villageId,
        battleId: user.battleId,
        level: user.level,
        status: user.status,
        stealthActive: true,
      });

      const duration = calcStealthDuration(user.stealth);
      return {
        success: true,
        message: `Stealth activated for ${Math.floor(duration / 60)} minutes`,
        data: { stealthActivatedAt },
      };
    }),

  // Deactivate stealth mode
  deactivateStealth: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Deactivate stealth mode" } })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Query
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });

      // Guard
      if (!user) throw serverError("NOT_FOUND", "User not found");
      if (!user.stealthActive) return errorResponse("Stealth is not active");

      // Mutation
      const result = await ctx.drizzle
        .update(userData)
        .set({
          stealthActive: false,
          stealthActivatedAt: null,
        })
        .where(and(eq(userData.userId, ctx.userId), eq(userData.stealthActive, true)));

      if (result.rowsAffected === 0) {
        return errorResponse("Stealth is not active");
      }

      // Broadcast with stealthActive: false so other clients show this user on their map
      void updateUserOnMap(pusher, user.sector, {
        userId: user.userId,
        sector: user.sector,
        longitude: user.longitude,
        latitude: user.latitude,
        username: user.username,
        avatar: user.avatar,
        avatarLight: user.avatarLight,
        location: user.location,
        villageId: user.villageId,
        battleId: user.battleId,
        level: user.level,
        status: user.status,
        stealthActive: false,
      });

      return { success: true, message: "Stealth deactivated" };
    }),

  // Use sensory to scan for stealthed enemies in the sector
  useSensory: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Scan for stealthed users in sector" } })
    .input(useSensoryInputSchema)
    .output(
      baseServerResponse.extend({
        data: useSensoryDataSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query (parallel)
      const [{ user }, stealthedUsers, alliances] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        ctx.drizzle.query.userData.findMany({
          where: and(
            eq(userData.sector, input.sector),
            eq(userData.stealthActive, true),
            sql`${userData.userId} != ${ctx.userId}`,
          ),
          columns: {
            userId: true,
            username: true,
            longitude: true,
            latitude: true,
            sector: true,
            avatar: true,
            avatarLight: true,
            location: true,
            villageId: true,
            battleId: true,
            level: true,
            status: true,
          },
        }),
        ctx.drizzle.select().from(villageAlliance),
      ]);

      // Guard
      if (!user) throw serverError("NOT_FOUND", "User not found");
      if (user.status !== "AWAKE") return errorResponse("Must be awake to use sensory");
      if (user.sector !== input.sector)
        return errorResponse("You are not in this sector");
      if (!isSensoryReady(user.lastSensoryAt, user.sensory)) {
        const remaining = getRemainingSensoryCooldown(user.lastSensoryAt, user.sensory);
        return errorResponse(
          `Sensory is on cooldown for ${Math.ceil(remaining)} more seconds`,
        );
      }

      // Derived - get all allied village IDs (same village + formal allies)
      const alliedVillageIds = alliances
        .filter(
          (a) => a.villageIdA === user.villageId || a.villageIdB === user.villageId,
        )
        .filter((a) => a.status === "ALLY")
        .flatMap((a) => [a.villageIdA, a.villageIdB]);
      const alliedSet = new Set(
        user.villageId ? [user.villageId, ...alliedVillageIds] : [],
      );

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

      // Mutation
      const updates: Promise<unknown>[] = [
        ctx.drizzle
          .update(userData)
          .set({ lastSensoryAt })
          .where(eq(userData.userId, ctx.userId)),
      ];

      if (detectedUserIds.length > 0) {
        updates.push(
          ctx.drizzle
            .update(userData)
            .set({ stealthActive: false, stealthActivatedAt: null })
            .where(inArray(userData.userId, detectedUserIds)),
        );
      }

      await Promise.all(updates);

      // Broadcast map updates and notifications for detected users
      if (detectedUsers.length > 0) {
        const broadcasts = detectedUsers.flatMap((detectedUser) => [
          // Broadcast to sector so they appear on the map for everyone
          updateUserOnMap(pusher, detectedUser.sector, {
            userId: detectedUser.userId,
            sector: detectedUser.sector,
            longitude: detectedUser.longitude,
            latitude: detectedUser.latitude,
            username: detectedUser.username,
            avatar: detectedUser.avatar,
            avatarLight: detectedUser.avatarLight,
            location: detectedUser.location,
            villageId: detectedUser.villageId,
            battleId: detectedUser.battleId,
            level: detectedUser.level,
            status: detectedUser.status,
            stealthActive: false,
          }),
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
      return {
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
      };
    }),

  // Start covert training (stealth or sensory)
  trainCovert: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Start stealth or sensory training" } })
    .input(trainInputSchema)
    .output(
      baseServerResponse.extend({
        data: startTrainDataSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });

      // Guard
      if (!user) throw serverError("NOT_FOUND", "User not found");
      if (user.status !== "AWAKE") return errorResponse("Must be awake to train");
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
      );
      const finishAt = new Date(Date.now() + input.minutes * 60 * 1000);

      // Mutation
      const result = await ctx.drizzle
        .update(userData)
        .set({
          covertTrainingType: input.type,
          covertTrainingStartedAt: new Date(),
          covertTrainingMinutes: input.minutes,
        })
        .where(
          and(
            eq(userData.userId, ctx.userId),
            isNull(userData.covertTrainingType),
            eq(userData.status, "AWAKE"),
          ),
        );

      if (result.rowsAffected === 0) {
        return errorResponse(`Failed to start ${input.type} training`);
      }

      return {
        success: true,
        message: `Started ${input.minutes} minute ${input.type} training`,
        data: {
          covertTrainingType: input.type as CovertTrainingType,
          covertTrainingFinishAt: finishAt,
          covertTrainingGain: expectedGain,
        },
      };
    }),

  // Stop covert training and collect rewards
  stopCovertTraining: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Stop covert training and collect rewards" },
    })
    .output(
      baseServerResponse.extend({
        data: stopTrainDataSchema.optional(),
      }),
    )
    .mutation(async ({ ctx }) => {
      // Query
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });

      // Guard
      if (!user) throw serverError("NOT_FOUND", "User not found");
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
      );
      const newValue = Math.min(currentStat + gained, STEALTH_SENSORY_CAP);

      // Mutation
      const result = await ctx.drizzle
        .update(userData)
        .set({
          covertTrainingType: null,
          covertTrainingStartedAt: null,
          covertTrainingMinutes: null,
          ...(user.covertTrainingType === "stealth"
            ? {
                stealth: sql`LEAST(${userData.stealth} + ${gained}, ${STEALTH_SENSORY_CAP})`,
              }
            : {
                sensory: sql`LEAST(${userData.sensory} + ${gained}, ${STEALTH_SENSORY_CAP})`,
              }),
        })
        .where(eq(userData.userId, ctx.userId));

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
    .meta({ mcp: { enabled: true, description: "Cancel covert training" } })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Mutation (with guard in WHERE clause)
      const result = await ctx.drizzle
        .update(userData)
        .set({
          covertTrainingType: null,
          covertTrainingStartedAt: null,
          covertTrainingMinutes: null,
        })
        .where(
          and(
            eq(userData.userId, ctx.userId),
            sql`${userData.covertTrainingType} IS NOT NULL`,
          ),
        );

      if (result.rowsAffected === 0) {
        return errorResponse("Not currently training covert skills");
      }

      return { success: true, message: "Training cancelled" };
    }),
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
  await drizzle
    .update(userData)
    .set({ stealthActive: false, stealthActivatedAt: null })
    .where(eq(userData.userId, userId));
  return true;
};

/**
 * Set stealth cooldown after combat ends.
 * Prevents users from immediately re-entering stealth after a battle.
 *
 * @param drizzle - Database client instance
 * @param userId - The user ID to apply the cooldown to
 */
export const setStealthCooldown = async (
  drizzle: Parameters<typeof fetchUpdatedUser>[0]["client"],
  userId: string,
): Promise<void> => {
  await drizzle
    .update(userData)
    .set({
      stealthActive: false,
      stealthActivatedAt: null,
      stealthCooldownAt: secondsFromNow(STEALTH_POST_COMBAT_COOLDOWN_SECONDS),
    })
    .where(eq(userData.userId, userId));
};
