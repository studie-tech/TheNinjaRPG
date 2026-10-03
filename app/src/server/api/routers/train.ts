import { type AnyColumn, and, eq, gt, isNull, sql } from "drizzle-orm";
import { getUserCaps, MAX_DAILY_TRAININGS } from "@/drizzle/constants";
import { trainingLog, userData } from "@/drizzle/schema";
import { showTrainingCapcha } from "@/libs/captcha";
import { getGameSettingBoost } from "@/libs/gameSettingBoost";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import {
  energyPerSecond,
  masteryTrainingBlockMessage,
  statTrainingBlockMessage,
  trainEfficiency,
  trainingMultiplier,
} from "@/libs/train";
import { validateCaptcha } from "@/routers/misc";
import { fetchUpdatedUser } from "@/routers/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { secondsPassed } from "@/utils/time";
import { getShrineBoost, getStrucBoost } from "@/utils/village";
import {
  startMasteryTrainingDataSchema,
  startMasteryTrainingInputSchema,
  startTrainingDataSchema,
  startTrainingInputSchema,
  stopMasteryTrainingDataSchema,
  stopTrainingDataSchema,
  stopTrainingInputSchema,
  trainingLogInputSchema,
  updateTrainingSpeedInputSchema,
} from "@/validators/train";

export const trainRouter = createTRPCRouter({
  startTraining: protectedProcedure
    .meta({ mcp: { description: "Start training a combat stat" } })
    .input(startTrainingInputSchema)
    .output(baseServerResponse.extend({ data: startTrainingDataSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        userIp: ctx.userIp,
        forceRegen: true,
      });
      if (!user) return errorResponse("User not found");
      const block = statTrainingBlockMessage(user);
      if (block) return errorResponse(block);
      const data = { trainingStartedAt: new Date(), currentlyTraining: input.stat };
      const result = await ctx.drizzle
        .update(userData)
        .set(data)
        .where(
          and(
            eq(userData.userId, ctx.userId),
            isNull(userData.currentlyTraining),
            eq(userData.status, "AWAKE"),
            dailyTrainingBudgetRemains(userData.currentlyTrainingMastery),
          ),
        );
      if (result.rowsAffected === 0) {
        return explainRejectedStart(ctx, "combat");
      }
      return { success: true, message: `Started training`, data };
    }),
  startMasteryTraining: protectedProcedure
    .meta({ mcp: { description: "Start training a mastery" } })
    .input(startMasteryTrainingInputSchema)
    .output(
      baseServerResponse.extend({ data: startMasteryTrainingDataSchema.optional() }),
    )
    .mutation(async ({ ctx, input }) => {
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        userIp: ctx.userIp,
        forceRegen: true,
      });
      if (!user) return errorResponse("User not found");
      const block = masteryTrainingBlockMessage(user);
      if (block) return errorResponse(block);
      const { mastery_cap } = getUserCaps(user.rank);
      if (user[input.stat] >= mastery_cap) return errorResponse("Already capped");
      const data = {
        masteryTrainingStartedAt: new Date(),
        currentlyTrainingMastery: input.stat,
      };
      const result = await ctx.drizzle
        .update(userData)
        .set(data)
        .where(
          and(
            eq(userData.userId, ctx.userId),
            isNull(userData.currentlyTrainingMastery),
            eq(userData.status, "AWAKE"),
            dailyTrainingBudgetRemains(userData.currentlyTraining),
          ),
        );
      if (result.rowsAffected === 0) {
        return explainRejectedStart(ctx, "mastery");
      }
      return { success: true, message: `Started mastery training`, data };
    }),
  stopTraining: protectedProcedure
    .meta({
      mcp: {
        description: "Stop combat stat training and collect gains",
      },
    })
    .input(stopTrainingInputSchema)
    .output(baseServerResponse.extend({ data: stopTrainingDataSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      const { user, settings } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        forceRegen: true,
      });
      // Guard
      if (!user) return errorResponse("User not found");
      if (user.status !== "AWAKE") return errorResponse("Must be awake");
      const trained = user.currentlyTraining;
      const startedAt = user.trainingStartedAt;
      if (!trained || !startedAt) return errorResponse("Not currently training");
      if (showTrainingCapcha(user)) {
        if (!input.guess) return errorResponse("Captcha required");
        if (!(await validateCaptcha(ctx.drizzle, ctx.userId, input.guess))) {
          return errorResponse("Invalid captcha");
        }
      }
      const { trainingAmount } = calcTrainingAmount(user, settings, startedAt);
      const finishedAt = new Date();
      // A combat stop settles the union of both active sessions up to its finish.
      // This includes mastery-only time before combat started, but skips time
      // already settled by an earlier combat stop.
      const creditFrom = Math.max(
        Math.min(
          startedAt.getTime(),
          user.currentlyTrainingMastery && user.masteryTrainingStartedAt
            ? user.masteryTrainingStartedAt.getTime()
            : startedAt.getTime(),
        ),
        user.lastCombatTrainingFinishedAt?.getTime() ?? 0,
      );
      const minutes = Math.max(0, (finishedAt.getTime() - creditFrom) / 60_000);
      const { trackers } = getNewTrackers(user, [
        { task: "stats_trained", increment: trainingAmount },
        { task: "minutes_training", increment: minutes },
      ]);
      const questDataForDb = filterQuestTrackersForDbPersist(trackers, user);
      // Claims exactly the session read above: a stale stop must not credit it twice
      // or end a session started after it
      const result = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: user.updatedAt,
        set: {
          trainingStartedAt: null,
          currentlyTraining: null,
          ...(trainingAmount > 0
            ? {
                experience: sql`experience + ${trainingAmount}`,
                dailyTrainings: sql`dailyTrainings + 1`,
                [trained]: sql`${userData[trained]} + ${trainingAmount}`,
                questData: questDataForDb,
                lastCombatTrainingFinishedAt: finishedAt,
              }
            : {}),
        },
        where: [trainingSlotsUnchanged(user), eq(userData.status, "AWAKE")],
      });
      if (!result.success) {
        return errorResponse("Training changed while stopping. Please try again");
      }
      if (trainingAmount > 0) {
        await ctx.drizzle.insert(trainingLog).values({
          userId: ctx.userId,
          amount: trainingAmount,
          stat: trained,
          speed: user.trainingSpeed,
          trainingFinishedAt: finishedAt,
        });
      }
      return {
        success: true,
        message: `You gained ${trainingAmount.toFixed(2)} ${trained}`,
        data: {
          experience: trainingAmount,
          currentlyTraining: trained,
          questData: trackers,
        },
      };
    }),
  stopMasteryTraining: protectedProcedure
    .meta({
      mcp: { description: "Stop mastery training and collect gains" },
    })
    .input(stopTrainingInputSchema)
    .output(
      baseServerResponse.extend({ data: stopMasteryTrainingDataSchema.optional() }),
    )
    .mutation(async ({ ctx, input }) => {
      const { user, settings } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        forceRegen: true,
      });
      if (!user) return errorResponse("User not found");
      if (user.status !== "AWAKE") return errorResponse("Must be awake");
      const trained = user.currentlyTrainingMastery;
      const startedAt = user.masteryTrainingStartedAt;
      if (!trained || !startedAt) {
        return errorResponse("Not currently training a mastery");
      }
      if (showTrainingCapcha(user)) {
        if (!input.guess) return errorResponse("Captcha required");
        if (!(await validateCaptcha(ctx.drizzle, ctx.userId, input.guess))) {
          return errorResponse("Invalid captcha");
        }
      }
      const { trainingAmount } = calcTrainingAmount(user, settings, startedAt);
      const { mastery_cap } = getUserCaps(user.rank);
      const gained = Math.max(0, Math.min(trainingAmount, mastery_cap - user[trained]));
      // Combat owns its interval, including any overlap. If it is still running,
      // mastery can settle only its earlier prefix; if it has stopped, that stop
      // already settled the active mastery prefix too.
      const creditFrom = Math.max(
        startedAt.getTime(),
        user.lastCombatTrainingFinishedAt?.getTime() ?? 0,
      );
      const creditUntil =
        user.currentlyTraining && user.trainingStartedAt
          ? user.trainingStartedAt.getTime()
          : Date.now();
      const creditedMinutes =
        gained > 0 ? Math.max(0, (creditUntil - creditFrom) / 60_000) : 0;
      const questData =
        creditedMinutes > 0
          ? filterQuestTrackersForDbPersist(
              getNewTrackers(user, [
                { task: "minutes_training", increment: creditedMinutes },
              ]).trackers,
              user,
            )
          : undefined;
      // Claims exactly the session read above, as stopTraining does
      const result = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: user.updatedAt,
        set: {
          masteryTrainingStartedAt: null,
          currentlyTrainingMastery: null,
          ...(gained > 0
            ? {
                dailyTrainings: sql`dailyTrainings + 1`,
                // LEAST keeps the gain inside the rank cap, and GREATEST keeps a value
                // already above it (kept for a rank-up) from being lowered. Nothing else
                // clamps stored masteries: capUserStats only caps in-memory copies.
                [trained]: sql`GREATEST(${userData[trained]}, LEAST(${userData[trained]} + ${trainingAmount}, ${mastery_cap}))`,
              }
            : {}),
          ...(questData ? { questData } : {}),
        },
        where: [trainingSlotsUnchanged(user), eq(userData.status, "AWAKE")],
      });
      if (!result.success) {
        return errorResponse("Training changed while stopping. Please try again");
      }
      if (gained > 0) {
        await ctx.drizzle.insert(trainingLog).values({
          userId: ctx.userId,
          amount: gained,
          stat: trained,
          speed: user.trainingSpeed,
          trainingFinishedAt: new Date(),
        });
      }
      const capNote =
        gained < trainingAmount ? ` (capped at ${mastery_cap.toLocaleString()})` : "";
      return {
        success: true,
        message: `You gained ${gained.toFixed(2)} ${trained}${capNote}`,
        data: {
          amount: gained,
          currentlyTrainingMastery: trained,
          creditedMinutes,
        },
      };
    }),
  updateTrainingSpeed: protectedProcedure
    .meta({ mcp: { description: "Update training speed interval" } })
    .input(updateTrainingSpeedInputSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      if (!user) return errorResponse("User not found");
      if (user.currentlyTraining || user.currentlyTrainingMastery) {
        return errorResponse("Cannot change training speed while training");
      }
      const result = await ctx.drizzle
        .update(userData)
        .set({ trainingSpeed: input.speed })
        .where(eq(userData.userId, ctx.userId));
      if (result.rowsAffected === 0) {
        return errorResponse("Could not update user");
      }
      return { success: true, message: "Training speed updated" };
    }),
  getTrainingLog: protectedProcedure
    .meta({
      mcp: {
        description: "Get user training history from last 24 hours",
      },
    })
    .input(trainingLogInputSchema)
    .query(async ({ ctx, input }) => {
      return ctx.drizzle.query.trainingLog.findMany({
        where: and(
          eq(trainingLog.userId, input.userId),
          gt(trainingLog.trainingFinishedAt, sql`NOW() - INTERVAL 1 DAY`),
        ),
      });
    }),
});

/** Training gains from village/clan/game boosts and time spent in a training slot */
const calcTrainingAmount = (
  user: NonNullable<Awaited<ReturnType<typeof fetchUpdatedUser>>["user"]>,
  settings: Awaited<ReturnType<typeof fetchUpdatedUser>>["settings"],
  startedAt: Date,
) => {
  const sectors = user?.village?.sectors.length ?? 0;
  const shrineBoost = getShrineBoost(sectors, "Training", user.village);
  const trainSetting = getGameSettingBoost("trainingGainMultiplier", settings);
  const warSetting = getGameSettingBoost(`war-${user.villageId}-train`, settings);
  const gameFactor = trainSetting?.value ?? 1;
  const warFactor = (100 + (warSetting?.value ?? 0)) / 100;
  const boost = getStrucBoost("trainBoostPerLvl", user.village?.structures) / 100;
  const clanBoost = user?.isOutlaw ? 0 : (user?.clan?.trainingBoost ?? 0) / 100;
  const factor = gameFactor * (1 + boost + clanBoost + shrineBoost) * warFactor;
  const seconds = secondsPassed(startedAt, undefined, false);
  const energySpent = Math.min(
    Math.floor(energyPerSecond(user.trainingSpeed) * seconds),
    100,
  );
  const trainingAmount =
    factor * energySpent * trainEfficiency(user) * trainingMultiplier(user);
  return { trainingAmount };
};

/**
 * The other slot, if it is already running, will spend one training when it stops.
 * Checked in the UPDATE so two starts cannot both pass while one daily training remains.
 */
const dailyTrainingBudgetRemains = (otherSlot: AnyColumn) =>
  sql`${userData.dailyTrainings} + (${otherSlot} IS NOT NULL) < ${MAX_DAILY_TRAININGS}`;

/** The start UPDATE matches slot, status and the daily budget together, so say which one failed. */
const explainRejectedStart = async (
  ctx: { drizzle: DrizzleClient; userId: string },
  slot: "combat" | "mastery",
) => {
  const { user } = await fetchUpdatedUser({
    client: ctx.drizzle,
    userId: ctx.userId,
  });
  if (!user) return errorResponse("User not found");
  const block =
    slot === "combat"
      ? statTrainingBlockMessage(user)
      : masteryTrainingBlockMessage(user);
  return errorResponse(
    block ??
      (slot === "combat"
        ? "You are already training a combat stat"
        : "You are already training a mastery"),
  );
};

/** Starts do not claim updatedAt, so also guard both intervals used to divide minutes. */
const trainingSlotsUnchanged = (
  user: NonNullable<Awaited<ReturnType<typeof fetchUpdatedUser>>["user"]>,
) =>
  and(
    user.currentlyTraining
      ? eq(userData.currentlyTraining, user.currentlyTraining)
      : isNull(userData.currentlyTraining),
    user.trainingStartedAt
      ? eq(userData.trainingStartedAt, user.trainingStartedAt)
      : isNull(userData.trainingStartedAt),
    user.currentlyTrainingMastery
      ? eq(userData.currentlyTrainingMastery, user.currentlyTrainingMastery)
      : isNull(userData.currentlyTrainingMastery),
    user.masteryTrainingStartedAt
      ? eq(userData.masteryTrainingStartedAt, user.masteryTrainingStartedAt)
      : isNull(userData.masteryTrainingStartedAt),
  );
