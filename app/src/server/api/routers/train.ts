import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  MAX_DAILY_TRAININGS,
  TrainingSpeeds,
  UserStatNames,
} from "@/drizzle/constants";
import { trainingLog, userData } from "@/drizzle/schema";
import { showTrainingCapcha } from "@/libs/captcha";
import { getGameSettingBoost } from "@/libs/gamesettings";
import { getNewTrackers } from "@/libs/quest";
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
  // Start training of a specific attribute
  startTraining: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Start training a specific stat" } })
    .input(z.object({ stat: z.enum(UserStatNames) }))
    .output(
      baseServerResponse.extend({
        data: z
          .object({
            currentlyTraining: z.enum(UserStatNames),
            trainingStartedAt: z.date(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        userIp: ctx.userIp,
        forceRegen: true,
      });
      // Derived
      if (!user) throw serverError("NOT_FOUND", "User not found");
      const inVillage = calcIsInVillage({ x: user.longitude, y: user.latitude });
      // Guard
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
      // Mutate
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
        return errorResponse("You are already training");
      } else {
        return { success: true, message: `Started training`, data };
      }
    }),
  // Stop training
  stopTraining: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Stop training and collect stat gains" },
    })
    .input(z.object({ guess: z.string().optional(), villageId: z.string().nullable() }))
    .output(
      baseServerResponse.extend({
        data: z
          .object({
            experience: z.number(),
            currentlyTraining: z.enum(UserStatNames),
            questData: z.array(QuestTracker),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user, settings }] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          forceRegen: true,
        }),
      ]);
      // Guard
      if (!user) throw serverError("NOT_FOUND", "User not found");
      if (user.status !== "AWAKE") return errorResponse("Must be awake");
      if (!user.trainingStartedAt) return errorResponse("Not currently training");
      if (!user.currentlyTraining) return errorResponse("Not currently training");
      // Captcha check
      if (showTrainingCapcha(user)) {
        if (!input.guess) return errorResponse("Captcha required");
        if (!(await validateCaptcha(ctx.drizzle, ctx.userId, input.guess))) {
          return errorResponse("Invalid captcha");
        }
      }
      // Derived training gain
      const sectors = user?.village?.sectors.length ?? 0;
      const shrineBoost = getShrineBoost(sectors, "Training", user.village);
      const trainSetting = getGameSettingBoost("trainingGainMultiplier", settings);
      const warSetting = getGameSettingBoost(`war-${user.villageId}-train`, settings);
      const gameFactor = trainSetting?.value ?? 1;
      const warFactor = (100 + (warSetting?.value ?? 0)) / 100;
      const boost = getStrucBoost("trainBoostPerLvl", user.village?.structures) / 100;
      // Only apply clan boost for real clans (not outlaw factions/towns)
      const clanBoost = user?.isOutlaw ? 0 : (user?.clan?.trainingBoost ?? 0) / 100;
      const factor = gameFactor * (1 + boost + clanBoost + shrineBoost) * warFactor;
      const seconds = (Date.now() - user.trainingStartedAt.getTime()) / 1000;
      const minutes = seconds / 60;
      const energySpent = Math.min(
        Math.floor(energyPerSecond(user.trainingSpeed) * seconds),
        100,
      );
      const trainingAmount =
        factor * energySpent * trainEfficiency(user) * trainingMultiplier(user);
      // Mutate
      const { trackers } = getNewTrackers(user, [
        { task: "stats_trained", increment: trainingAmount },
        { task: "minutes_training", increment: minutes },
      ]);
      user.questData = trackers;
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
                  strength:
                    user.currentlyTraining === "strength"
                      ? sql`strength + ${trainingAmount}`
                      : sql`strength`,
                  intelligence:
                    user.currentlyTraining === "intelligence"
                      ? sql`intelligence + ${trainingAmount}`
                      : sql`intelligence`,
                  willpower:
                    user.currentlyTraining === "willpower"
                      ? sql`willpower + ${trainingAmount}`
                      : sql`willpower`,
                  speed:
                    user.currentlyTraining === "speed"
                      ? sql`speed + ${trainingAmount}`
                      : sql`speed`,
                  ninjutsuOffence:
                    user.currentlyTraining === "ninjutsuOffence"
                      ? sql`ninjutsuOffence + ${trainingAmount}`
                      : sql`ninjutsuOffence`,
                  ninjutsuDefence:
                    user.currentlyTraining === "ninjutsuDefence"
                      ? sql`ninjutsuDefence + ${trainingAmount}`
                      : sql`ninjutsuDefence`,
                  genjutsuOffence:
                    user.currentlyTraining === "genjutsuOffence"
                      ? sql`genjutsuOffence + ${trainingAmount}`
                      : sql`genjutsuOffence`,
                  genjutsuDefence:
                    user.currentlyTraining === "genjutsuDefence"
                      ? sql`genjutsuDefence + ${trainingAmount}`
                      : sql`genjutsuDefence`,
                  taijutsuOffence:
                    user.currentlyTraining === "taijutsuOffence"
                      ? sql`taijutsuOffence + ${trainingAmount}`
                      : sql`taijutsuOffence`,
                  taijutsuDefence:
                    user.currentlyTraining === "taijutsuDefence"
                      ? sql`taijutsuDefence + ${trainingAmount}`
                      : sql`taijutsuDefence`,
                  bukijutsuDefence:
                    user.currentlyTraining === "bukijutsuDefence"
                      ? sql`bukijutsuDefence + ${trainingAmount}`
                      : sql`bukijutsuDefence`,
                  bukijutsuOffence:
                    user.currentlyTraining === "bukijutsuOffence"
                      ? sql`bukijutsuOffence + ${trainingAmount}`
                      : sql`bukijutsuOffence`,
                  questData: user.questData,
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
                stat: user.currentlyTraining,
                speed: user.trainingSpeed,
                trainingFinishedAt: new Date(),
              }),
            ]
          : []),
      ]);
      if (result.rowsAffected === 0) {
        return { success: false, message: "You are not training" };
      } else {
        return {
          success: true,
          message: `You gained ${trainingAmount.toFixed(2)} ${user.currentlyTraining}`,
          data: {
            experience: trainingAmount,
            currentlyTraining: user.currentlyTraining,
            questData: user.questData,
          },
        };
      }
    }),
  // Update user training speed
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
      if (user.currentlyTraining) {
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
      } else {
        return { success: true, message: "Training speed updated" };
      }
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
