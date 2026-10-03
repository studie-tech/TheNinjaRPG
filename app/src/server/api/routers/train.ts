import { and, eq, gt, gte, isNull, sql } from "drizzle-orm";
import {
  getUserCaps,
  MAX_DAILY_TRAININGS,
  STATS_PER_ENERGY,
} from "@/drizzle/constants";
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
import type { UserWithRelations } from "@/routers/profile";
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
  stopTrainingInputSchema,
  trainingLogInputSchema,
  updateTrainingSpeedInputSchema,
} from "@/validators/train";

export const trainRouter = createTRPCRouter({
  startTraining: protectedProcedure
    .meta({ mcp: { description: "Spend Energy to instantly train a combat stat" } })
    .input(startTrainingInputSchema)
    .output(baseServerResponse.extend({ data: startTrainingDataSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      const { user, settings } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        userIp: ctx.userIp,
        forceRegen: true,
      });
      if (!user) return errorResponse("User not found");
      const block = statTrainingBlockMessage(user);
      if (block) return errorResponse(block);
      if (showTrainingCapcha(user)) {
        if (!input.guess) return errorResponse("Captcha required");
        if (!(await validateCaptcha(ctx.drizzle, ctx.userId, input.guess)))
          return errorResponse("Invalid captcha");
      }
      const { stats_cap, gens_cap } = getUserCaps(user.rank);
      const cap =
        input.stat === "offence" || input.stat === "defence" ? stats_cap : gens_cap;
      const rate = STATS_PER_ENERGY * trainingBoost(user, settings);
      const availableRoom = Math.max(0, cap - user[input.stat]);
      if (availableRoom === 0) return errorResponse("Already capped");
      if (input.energy > user.curEnergy) return errorResponse("Not enough Energy");
      const spent = Math.min(input.energy, availableRoom / rate);
      const amount = spent * rate;
      if (amount <= 0) return errorResponse("No training gains available");
      const { trackers } = getNewTrackers(user, [
        { task: "stats_trained", increment: amount },
      ]);
      const claim = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: user.updatedAt,
        set: {
          curEnergy: sql`${userData.curEnergy} - ${spent}`,
          [input.stat]: sql`${userData[input.stat]} + ${amount}`,
          experience: sql`${userData.experience} + ${amount}`,
          questData: filterQuestTrackersForDbPersist(trackers, user),
        },
        where: [
          eq(userData.status, "AWAKE"),
          gte(userData.curEnergy, spent),
          sql`${userData[input.stat]} + ${amount} <= ${cap}`,
        ],
      });
      if (!claim.success)
        return errorResponse("Your stats or Energy changed. Please try again");
      await ctx.drizzle.insert(trainingLog).values({
        userId: ctx.userId,
        amount,
        stat: input.stat,
        speed: user.trainingSpeed,
        trainingFinishedAt: new Date(),
      });
      return {
        success: true,
        message: `You gained ${amount.toFixed(2)} ${input.stat}`,
        data: {
          experience: amount,
          amount,
          stat: input.stat,
          curEnergy: user.curEnergy - spent,
        },
      };
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
            sql`${userData.dailyTrainings} < ${MAX_DAILY_TRAININGS}`,
          ),
        );
      if (result.rowsAffected === 0) {
        return explainRejectedStart(ctx, "mastery");
      }
      return { success: true, message: `Started mastery training`, data };
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
      const creditedMinutes =
        gained > 0 ? Math.max(0, (Date.now() - startedAt.getTime()) / 60_000) : 0;
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
        where: [
          eq(userData.currentlyTrainingMastery, trained),
          eq(userData.masteryTrainingStartedAt, startedAt),
          eq(userData.status, "AWAKE"),
        ],
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
      if (user.currentlyTrainingMastery) {
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

/** Village, clan and global bonuses shared by Energy and mastery training. */
export const trainingBoost = (
  user: NonNullable<UserWithRelations>,
  settings: Awaited<ReturnType<typeof fetchUpdatedUser>>["settings"],
) => {
  const sectors = user.village?.sectors?.length ?? 0;
  const shrineBoost = getShrineBoost(sectors, "Training", user.village);
  const trainSetting = getGameSettingBoost("trainingGainMultiplier", settings);
  const warSetting = getGameSettingBoost(`war-${user.villageId}-train`, settings);
  const boost = getStrucBoost("trainBoostPerLvl", user.village?.structures) / 100;
  const clanBoost = user.isOutlaw ? 0 : (user.clan?.trainingBoost ?? 0) / 100;
  return (
    ((trainSetting?.value ?? 1) *
      (1 + boost + clanBoost + shrineBoost) *
      (100 + (warSetting?.value ?? 0))) /
    100
  );
};

export const calcTrainingAmount = (
  user: NonNullable<UserWithRelations>,
  settings: Awaited<ReturnType<typeof fetchUpdatedUser>>["settings"],
  startedAt: Date,
) => ({
  trainingAmount:
    trainingBoost(user, settings) *
    Math.min(
      Math.floor(
        energyPerSecond(user.trainingSpeed) *
          secondsPassed(startedAt, undefined, false),
      ),
      100,
    ) *
    trainEfficiency(user) *
    trainingMultiplier(user),
});

const explainRejectedStart = async (
  ctx: { drizzle: DrizzleClient; userId: string },
  _slot: "mastery",
) => {
  const { user } = await fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId });
  return errorResponse(
    user
      ? (masteryTrainingBlockMessage(user) ?? "You are already training a mastery")
      : "User not found",
  );
};
