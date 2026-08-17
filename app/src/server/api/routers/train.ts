import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  CombatStatNames,
  getUserCaps,
  MAX_DAILY_TRAININGS,
  MasteryNames,
  TrainingSpeeds,
} from "@/drizzle/constants";
import { trainingLog, userData } from "@/drizzle/schema";
import { showTrainingCapcha } from "@/libs/captcha";
import { getGameSettingBoost } from "@/libs/gamesettings";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { energyPerSecond, trainEfficiency, trainingMultiplier } from "@/libs/train";
import { calcIsInVillage } from "@/libs/travel";
import { validateCaptcha } from "@/routers/misc";
import { fetchUpdatedUser } from "@/routers/profile";
import { getShrineBoost, getStrucBoost } from "@/utils/village";
import { QuestTracker } from "@/validators/objectives";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "../trpc";

export const trainRouter = createTRPCRouter({
  startTraining: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Start training a combat stat" } })
    .input(z.object({ stat: z.enum(CombatStatNames) }))
    .output(
      baseServerResponse.extend({
        data: z
          .object({
            currentlyTraining: z.enum(CombatStatNames),
            trainingStartedAt: z.date(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        userIp: ctx.userIp,
        forceRegen: true,
      });
      if (!user) throw serverError("NOT_FOUND", "User not found");
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
          ),
        );
      if (result.rowsAffected === 0) {
        return errorResponse("You are already training a combat stat");
      }
      return { success: true, message: `Started training`, data };
    }),
  startMasteryTraining: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Start training a mastery" } })
    .input(z.object({ stat: z.enum(MasteryNames) }))
    .output(
      baseServerResponse.extend({
        data: z
          .object({
            currentlyTrainingMastery: z.enum(MasteryNames),
            masteryTrainingStartedAt: z.date(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        userIp: ctx.userIp,
        forceRegen: true,
      });
      if (!user) throw serverError("NOT_FOUND", "User not found");
      const guard = assertCanStartTraining(user);
      if (guard) return guard;
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
          ),
        );
      if (result.rowsAffected === 0) {
        return errorResponse("You are already training a mastery");
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
    .input(z.object({ guess: z.string().optional(), villageId: z.string().nullable() }))
    .output(
      baseServerResponse.extend({
        data: z
          .object({
            experience: z.number(),
            currentlyTraining: z.enum(CombatStatNames),
            questData: z.array(QuestTracker),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [{ user, settings }] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          forceRegen: true,
        }),
      ]);
      if (!user) throw serverError("NOT_FOUND", "User not found");
      if (user.status !== "AWAKE") return errorResponse("Must be awake");
      if (!user.trainingStartedAt) return errorResponse("Not currently training");
      if (!user.currentlyTraining) return errorResponse("Not currently training");
      if (showTrainingCapcha(user)) {
        if (!input.guess) return errorResponse("Captcha required");
        if (!(await validateCaptcha(ctx.drizzle, ctx.userId, input.guess))) {
          return errorResponse("Invalid captcha");
        }
      }
      const { trainingAmount, minutes } = calcTrainingAmount(
        user,
        settings,
        user.trainingStartedAt,
      );
      const { trackers } = getNewTrackers(user, [
        { task: "stats_trained", increment: trainingAmount },
        { task: "minutes_training", increment: minutes },
      ]);
      const questDataForDb = filterQuestTrackersForDbPersist(trackers, user);
      const trained = user.currentlyTraining;
      const [result] = await Promise.all([
        ctx.drizzle
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
                }
              : {}),
          })
          .where(
            and(
              eq(userData.userId, ctx.userId),
              isNotNull(userData.currentlyTraining),
              eq(userData.status, "AWAKE"),
            ),
          ),
        ...(trainingAmount > 0
          ? [
              ctx.drizzle.insert(trainingLog).values({
                userId: ctx.userId,
                amount: trainingAmount,
                stat: trained,
                speed: user.trainingSpeed,
                trainingFinishedAt: new Date(),
              }),
            ]
          : []),
      ]);
      if (result.rowsAffected === 0) {
        return { success: false, message: "You are not training" };
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
    .input(z.object({ guess: z.string().optional(), villageId: z.string().nullable() }))
    .output(
      baseServerResponse.extend({
        data: z
          .object({
            amount: z.number(),
            currentlyTrainingMastery: z.enum(MasteryNames),
            questData: z.array(QuestTracker),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [{ user, settings }] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          forceRegen: true,
        }),
      ]);
      if (!user) throw serverError("NOT_FOUND", "User not found");
      if (user.status !== "AWAKE") return errorResponse("Must be awake");
      if (!user.masteryTrainingStartedAt) {
        return errorResponse("Not currently training a mastery");
      }
      if (!user.currentlyTrainingMastery) {
        return errorResponse("Not currently training a mastery");
      }
      if (showTrainingCapcha(user)) {
        if (!input.guess) return errorResponse("Captcha required");
        if (!(await validateCaptcha(ctx.drizzle, ctx.userId, input.guess))) {
          return errorResponse("Invalid captcha");
        }
      }
      const { trainingAmount } = calcTrainingAmount(
        user,
        settings,
        user.masteryTrainingStartedAt,
      );
      const { mastery_cap } = getUserCaps(user.rank);
      // No minutes_training credit here: both slots run over the same wall clock, so
      // crediting each would count every minute twice. The combat slot owns that tracker.
      const { trackers } = getNewTrackers(user, []);
      const questDataForDb = filterQuestTrackersForDbPersist(trackers, user);
      const trained = user.currentlyTrainingMastery;
      const [result] = await Promise.all([
        ctx.drizzle
          .update(userData)
          .set({
            masteryTrainingStartedAt: null,
            currentlyTrainingMastery: null,
            ...(trainingAmount > 0
              ? {
                  dailyTrainings: sql`dailyTrainings + 1`,
                  // LEAST keeps the gain inside the rank cap in the same statement, the way
                  // covert training does. Nothing else ever clamps masteries: capUserStats
                  // only touches the in-memory battle copy, and assignStats does not write
                  // mastery columns back.
                  [trained]: sql`LEAST(${userData[trained]} + ${trainingAmount}, ${mastery_cap})`,
                  questData: questDataForDb,
                }
              : {}),
          })
          .where(
            and(
              eq(userData.userId, ctx.userId),
              isNotNull(userData.currentlyTrainingMastery),
              eq(userData.status, "AWAKE"),
            ),
          ),
        ...(trainingAmount > 0
          ? [
              ctx.drizzle.insert(trainingLog).values({
                userId: ctx.userId,
                amount: trainingAmount,
                stat: trained,
                speed: user.trainingSpeed,
                trainingFinishedAt: new Date(),
              }),
            ]
          : []),
      ]);
      if (result.rowsAffected === 0) {
        return { success: false, message: "You are not training a mastery" };
      }
      return {
        success: true,
        message: `You gained ${trainingAmount.toFixed(2)} ${trained}`,
        data: {
          amount: trainingAmount,
          currentlyTrainingMastery: trained,
          questData: trackers,
        },
      };
    }),
  updateTrainingSpeed: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Update training speed interval" } })
    .input(z.object({ speed: z.enum(TrainingSpeeds) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      if (!user) {
        throw serverError("NOT_FOUND", "User not found");
      }
      if (user.currentlyTraining || user.currentlyTrainingMastery) {
        return {
          success: false,
          message: "Cannot change training speed while training",
        };
      }
      const result = await ctx.drizzle
        .update(userData)
        .set({ trainingSpeed: input.speed })
        .where(eq(userData.userId, ctx.userId));
      if (result.rowsAffected === 0) {
        return { success: false, message: "Could not update user" };
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
    .input(z.object({ userId: z.string() }))
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
  if (user.dailyTrainings >= MAX_DAILY_TRAININGS) {
    return errorResponse(
      `Training more than ${MAX_DAILY_TRAININGS} times within 24 hours not allowed`,
    );
  }
  return null;
};
