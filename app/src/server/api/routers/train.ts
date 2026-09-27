import { type AnyColumn, and, eq, gt, isNull, sql } from "drizzle-orm";
import { getUserCaps, MAX_DAILY_TRAININGS } from "@/drizzle/constants";
import { trainingLog, userData } from "@/drizzle/schema";
import { showTrainingCapcha } from "@/libs/captcha";
import { getGameSettingBoost } from "@/libs/gameSettingBoost";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { energyPerSecond, trainEfficiency, trainingMultiplier } from "@/libs/train";
import { calcIsInVillage } from "@/libs/travel";
import { validateCaptcha } from "@/routers/misc";
import { fetchUpdatedUser } from "@/routers/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
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
    .meta({ mcp: { enabled: true, description: "Start training a combat stat" } })
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
      const guard = assertCanStartTraining(user);
      if (guard) return guard;
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
    .meta({ mcp: { enabled: true, description: "Start training a mastery" } })
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
      const guard = assertCanStartTraining(user);
      if (guard) return guard;
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
        enabled: true,
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
      const { trainingAmount, minutes } = calcTrainingAmount(user, settings, startedAt);
      const finishedAt = new Date();
      const { trackers } = getNewTrackers(user, [
        { task: "stats_trained", increment: trainingAmount },
        { task: "minutes_training", increment: minutes },
      ]);
      const questDataForDb = filterQuestTrackersForDbPersist(trackers, user);
      // Claims exactly the session read above: a stale stop must not credit it twice
      // or end a session started after it
      const result = await ctx.drizzle
        .update(userData)
        .set({
          trainingStartedAt: null,
          currentlyTraining: null,
          ...(trainingAmount > 0
            ? {
                experience: sql`experience + ${trainingAmount}`,
                dailyTrainings: sql`dailyTrainings + 1`,
                offence:
                  trained === "offence"
                    ? sql`offence + ${trainingAmount}`
                    : sql`offence`,
                defence:
                  trained === "defence"
                    ? sql`defence + ${trainingAmount}`
                    : sql`defence`,
                strength:
                  trained === "strength"
                    ? sql`strength + ${trainingAmount}`
                    : sql`strength`,
                intelligence:
                  trained === "intelligence"
                    ? sql`intelligence + ${trainingAmount}`
                    : sql`intelligence`,
                willpower:
                  trained === "willpower"
                    ? sql`willpower + ${trainingAmount}`
                    : sql`willpower`,
                speed:
                  trained === "speed" ? sql`speed + ${trainingAmount}` : sql`speed`,
                questData: questDataForDb,
                lastCombatTrainingFinishedAt: finishedAt,
              }
            : {}),
        })
        .where(
          and(
            eq(userData.userId, ctx.userId),
            eq(userData.currentlyTraining, trained),
            eq(userData.trainingStartedAt, startedAt),
            eq(userData.status, "AWAKE"),
          ),
        );
      if (result.rowsAffected !== 1) {
        return errorResponse("This training session has already ended");
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
      mcp: { enabled: true, description: "Stop mastery training and collect gains" },
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
      // Both slots share the wall clock and the combat slot credits all of its minutes,
      // so only minutes it has not credited count: none while it runs, and none before
      // the finish time stored on this row with those minutes.
      const creditFrom = Math.max(
        startedAt.getTime(),
        user.lastCombatTrainingFinishedAt?.getTime() ?? 0,
      );
      const creditedMinutes =
        gained > 0 && !user.currentlyTraining
          ? Math.max(0, (Date.now() - creditFrom) / 60_000)
          : 0;
      // questData is written only when minutes are credited: the combat slot is idle
      // then, so no concurrent combat stop can be overwritten by this snapshot.
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
      const result = await ctx.drizzle
        .update(userData)
        .set({
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
        })
        .where(
          and(
            eq(userData.userId, ctx.userId),
            eq(userData.currentlyTrainingMastery, trained),
            eq(userData.masteryTrainingStartedAt, startedAt),
            eq(userData.status, "AWAKE"),
          ),
        );
      if (result.rowsAffected !== 1) {
        return errorResponse("This mastery training session has already ended");
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
    .meta({ mcp: { enabled: true, description: "Update training speed interval" } })
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
        enabled: true,
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
  const seconds = (Date.now() - startedAt.getTime()) / 1000;
  const minutes = seconds / 60;
  const energySpent = Math.min(
    Math.floor(energyPerSecond(user.trainingSpeed) * seconds),
    100,
  );
  const trainingAmount =
    factor * energySpent * trainEfficiency(user) * trainingMultiplier(user);
  return { trainingAmount, minutes };
};

/** Shared guards for starting either training slot. Returns an error response, or null */
const assertCanStartTraining = (
  user: NonNullable<Awaited<ReturnType<typeof fetchUpdatedUser>>["user"]>,
) => {
  const inVillage = calcIsInVillage({ x: user.longitude, y: user.latitude });
  if (user.status !== "AWAKE") return errorResponse("Must be awake to train");
  if (!user.isOutlaw) {
    if (!inVillage) return errorResponse("Must be in your own village");
    if (user.sector !== user.village?.sector) return errorResponse("Wrong sector");
  }
  if (user.trainingSpeed !== "8hrs" && user.isBanned) {
    return errorResponse("Only 8hrs training interval allowed when banned");
  }
  // A session still running in either slot will spend one training when it stops
  const inFlight =
    Number(!!user.currentlyTraining) + Number(!!user.currentlyTrainingMastery);
  if (user.dailyTrainings + inFlight >= MAX_DAILY_TRAININGS) {
    return errorResponse(
      `Training more than ${MAX_DAILY_TRAININGS} times within 24 hours not allowed`,
    );
  }
  return null;
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
  const occupied =
    slot === "combat" ? user.currentlyTraining : user.currentlyTrainingMastery;
  if (occupied) {
    return errorResponse(
      slot === "combat"
        ? "You are already training a combat stat"
        : "You are already training a mastery",
    );
  }
  return (
    assertCanStartTraining(user) ??
    errorResponse(
      slot === "combat"
        ? "You are already training a combat stat"
        : "You are already training a mastery",
    )
  );
};
