import { and, asc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  MAX_DAILY_TRAININGS,
  TrainingSpeeds,
  UserStatNames,
} from "@/drizzle/constants";
import { trainingLog, userData, userStatTrainingQueue } from "@/drizzle/schema";
import { showTrainingCapcha } from "@/libs/captcha";
import { getGameSettingBoost } from "@/libs/gamesettings";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { getNextQueueSchedule, rescheduleQueue } from "@/libs/queue";
import {
  trainEfficiency,
  trainingMultiplier,
  trainingSpeedSeconds,
} from "@/libs/train";
import { calcIsInVillage } from "@/libs/travel";
import { validateCaptcha } from "@/routers/misc";
import { fetchUpdatedUser } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import {
  getQueueOverview,
  getStatTrainingQueue,
  settleStatTrainingQueue,
} from "@/server/utils/queue";
import { getQueueTotalCapacity } from "@/utils/paypal";
import { getShrineBoost, getStrucBoost } from "@/utils/village";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "../trpc";

type UpdatedUserResult = Awaited<ReturnType<typeof fetchUpdatedUser>>;

const calculateTrainingSnapshot = (
  user: NonNullable<UpdatedUserResult["user"]>,
  settings: UpdatedUserResult["settings"],
) => {
  const sectors = user.village?.sectors.length ?? 0;
  const shrineBoost = getShrineBoost(sectors, "Training", user.village);
  const trainSetting = getGameSettingBoost("trainingGainMultiplier", settings);
  const warSetting = getGameSettingBoost(`war-${user.villageId}-train`, settings);
  const gameFactor = trainSetting?.value ?? 1;
  const warFactor = (100 + (warSetting?.value ?? 0)) / 100;
  const structureBoost =
    getStrucBoost("trainBoostPerLvl", user.village?.structures) / 100;
  const clanBoost = user.isOutlaw ? 0 : (user.clan?.trainingBoost ?? 0) / 100;
  const factor =
    gameFactor * (1 + structureBoost + clanBoost + shrineBoost) * warFactor;
  const durationSeconds = trainingSpeedSeconds(user.trainingSpeed);
  const fullGain = factor * 100 * trainEfficiency(user) * trainingMultiplier(user);
  return { durationSeconds, fullGain };
};

/** Lazily converts work that was active during deployment. The legacy columns
 * are cleared only in the same transaction that creates the queue snapshot. */
const backfillLegacyStatTraining = async (
  client: DrizzleClient,
  result: UpdatedUserResult,
) => {
  const { user, settings } = result;
  if (!user?.trainingStartedAt || !user.currentlyTraining) return false;
  const trainingStartedAt = user.trainingStartedAt;
  const currentlyTraining = user.currentlyTraining;
  const existing = await client.query.userStatTrainingQueue.findFirst({
    where: and(
      eq(userStatTrainingQueue.userId, user.userId),
      isNull(userStatTrainingQueue.completedAt),
      isNull(userStatTrainingQueue.cancelledAt),
    ),
  });
  if (existing) return false;
  const snapshot = calculateTrainingSnapshot(user, settings);
  const finishesAt = new Date(
    user.trainingStartedAt.getTime() + snapshot.durationSeconds * 1000,
  );
  await client.transaction(async (tx) => {
    const clear = await tx
      .update(userData)
      .set({ trainingStartedAt: null, currentlyTraining: null })
      .where(
        and(
          eq(userData.userId, user.userId),
          eq(userData.currentlyTraining, currentlyTraining),
          eq(userData.trainingStartedAt, trainingStartedAt),
        ),
      );
    if (clear.rowsAffected !== 1) return;
    await tx.insert(userStatTrainingQueue).values({
      id: nanoid(),
      userId: user.userId,
      stat: currentlyTraining,
      trainingSpeed: user.trainingSpeed,
      durationSeconds: snapshot.durationSeconds,
      fullStatGain: snapshot.fullGain,
      fullExperienceGain: snapshot.fullGain,
      startsAt: trainingStartedAt,
      finishesAt,
    });
  });
  return true;
};

const prepareStatQueue = async (client: DrizzleClient, userId: string) => {
  const initial = await fetchUpdatedUser({ client, userId, forceRegen: true });
  await backfillLegacyStatTraining(client, initial);
  await settleStatTrainingQueue(client, userId);
  return fetchUpdatedUser({ client, userId, forceRegen: true });
};

export const trainRouter = createTRPCRouter({
  getQueueOverview: protectedProcedure.query(({ ctx }) =>
    getQueueOverview(ctx.drizzle, ctx.userId),
  ),

  getTrainingQueue: protectedProcedure.query(async ({ ctx }) => {
    await prepareStatQueue(ctx.drizzle, ctx.userId);
    return getStatTrainingQueue(ctx.drizzle, ctx.userId);
  }),

  startTraining: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Queue training for a stat" } })
    .input(z.object({ stat: z.enum(UserStatNames), guess: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { user, settings } = await prepareStatQueue(ctx.drizzle, ctx.userId);
      if (!user) throw serverError("NOT_FOUND", "User not found");
      const queue = await ctx.drizzle.query.userStatTrainingQueue.findMany({
        where: and(
          eq(userStatTrainingQueue.userId, ctx.userId),
          isNull(userStatTrainingQueue.completedAt),
          isNull(userStatTrainingQueue.cancelledAt),
        ),
        orderBy: asc(userStatTrainingQueue.startsAt),
      });
      const inVillage = calcIsInVillage({ x: user.longitude, y: user.latitude });
      if (user.status !== "AWAKE") return errorResponse("Must be awake to train");
      if (!user.isOutlaw) {
        if (!inVillage) return errorResponse("Must be in your own village");
        if (user.sector !== user.village?.sector) return errorResponse("Wrong sector");
      }
      if (user.trainingSpeed !== "8hrs" && user.isBanned) {
        return errorResponse("Only 8hrs training interval allowed when banned");
      }
      if (user.dailyTrainings + queue.length >= MAX_DAILY_TRAININGS) {
        return errorResponse(
          `Training more than ${MAX_DAILY_TRAININGS} times within 24 hours not allowed`,
        );
      }
      if (
        showTrainingCapcha({
          ...user,
          dailyTrainings: user.dailyTrainings + queue.length,
        })
      ) {
        if (!input.guess) return errorResponse("Captcha required");
        if (!(await validateCaptcha(ctx.drizzle, ctx.userId, input.guess))) {
          return errorResponse("Invalid captcha");
        }
      }
      const snapshot = calculateTrainingSnapshot(user, settings);
      const enqueueResult = await ctx.drizzle.transaction(async (tx) => {
        const lock = await tx
          .update(userData)
          .set({ updatedAt: sql`${userData.updatedAt}` })
          .where(and(eq(userData.userId, ctx.userId), eq(userData.status, "AWAKE")));
        if (lock.rowsAffected !== 1) return "STATE_CHANGED" as const;
        const [currentUser, currentQueue] = await Promise.all([
          tx.query.userData.findFirst({ where: eq(userData.userId, ctx.userId) }),
          tx.query.userStatTrainingQueue.findMany({
            where: and(
              eq(userStatTrainingQueue.userId, ctx.userId),
              isNull(userStatTrainingQueue.completedAt),
              isNull(userStatTrainingQueue.cancelledAt),
            ),
            orderBy: asc(userStatTrainingQueue.startsAt),
          }),
        ]);
        if (!currentUser) return "STATE_CHANGED" as const;
        if (currentQueue.length >= getQueueTotalCapacity(currentUser)) {
          return "FULL" as const;
        }
        if (currentUser.dailyTrainings + currentQueue.length >= MAX_DAILY_TRAININGS) {
          return "DAILY_CAP" as const;
        }
        const schedule = getNextQueueSchedule(
          snapshot.durationSeconds,
          currentQueue.at(-1)?.finishesAt,
        );
        await tx.insert(userStatTrainingQueue).values({
          id: nanoid(),
          userId: ctx.userId,
          stat: input.stat,
          trainingSpeed: user.trainingSpeed,
          durationSeconds: snapshot.durationSeconds,
          fullStatGain: snapshot.fullGain,
          fullExperienceGain: snapshot.fullGain,
          ...schedule,
        });
        return "OK" as const;
      });
      if (enqueueResult === "FULL") return errorResponse("Stat training queue is full");
      if (enqueueResult === "DAILY_CAP")
        return errorResponse("Daily training limit reached");
      if (enqueueResult !== "OK")
        return errorResponse("State changed, please try again");
      return {
        success: true,
        message: `Queued ${input.stat} training`,
        queue: await getStatTrainingQueue(ctx.drizzle, ctx.userId),
      };
    }),

  stopTraining: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Stop active stat training" } })
    .input(z.object({ villageId: z.string().nullable().optional() }))
    .mutation(async ({ ctx }) => {
      const { user } = await prepareStatQueue(ctx.drizzle, ctx.userId);
      if (!user) throw serverError("NOT_FOUND", "User not found");
      if (user.status !== "AWAKE") return errorResponse("Must be awake");
      const now = new Date();
      const result = await ctx.drizzle.transaction(async (tx) => {
        await tx
          .update(userData)
          .set({ updatedAt: sql`${userData.updatedAt}` })
          .where(eq(userData.userId, ctx.userId));
        const active = await tx.query.userStatTrainingQueue.findFirst({
          where: and(
            eq(userStatTrainingQueue.userId, ctx.userId),
            isNull(userStatTrainingQueue.completedAt),
            isNull(userStatTrainingQueue.cancelledAt),
            lte(userStatTrainingQueue.startsAt, now),
            gt(userStatTrainingQueue.finishesAt, now),
          ),
          orderBy: asc(userStatTrainingQueue.startsAt),
        });
        if (!active) return null;
        const claim = await tx
          .update(userStatTrainingQueue)
          .set({ completedAt: now })
          .where(
            and(
              eq(userStatTrainingQueue.id, active.id),
              isNull(userStatTrainingQueue.completedAt),
              isNull(userStatTrainingQueue.cancelledAt),
            ),
          );
        if (claim.rowsAffected !== 1) return null;
        const elapsedSeconds = Math.max(
          0,
          Math.min(
            active.durationSeconds,
            (now.getTime() - active.startsAt.getTime()) / 1000,
          ),
        );
        const ratio = elapsedSeconds / active.durationSeconds;
        const statGain = active.fullStatGain * ratio;
        const experienceGain = active.fullExperienceGain * ratio;
        const { user: currentUser } = await fetchUpdatedUser({
          client: tx as DrizzleClient,
          userId: ctx.userId,
          skipQueueSettlement: true,
        });
        if (!currentUser) throw new Error("User not found while stopping training");
        const { trackers } = getNewTrackers(currentUser, [
          { task: "stats_trained", increment: statGain },
          { task: "minutes_training", increment: elapsedSeconds / 60 },
        ]);
        if (statGain > 0) {
          const statColumn = userData[active.stat];
          await tx
            .update(userData)
            .set({
              [active.stat]: sql`${statColumn} + ${statGain}`,
              experience: sql`${userData.experience} + ${experienceGain}`,
              dailyTrainings: sql`${userData.dailyTrainings} + 1`,
              questData: filterQuestTrackersForDbPersist(trackers, currentUser),
            })
            .where(eq(userData.userId, ctx.userId));
          await tx.insert(trainingLog).values({
            userId: ctx.userId,
            amount: statGain,
            stat: active.stat,
            speed: active.trainingSpeed,
            trainingFinishedAt: now,
          });
        }
        const waiting = await tx.query.userStatTrainingQueue.findMany({
          where: and(
            eq(userStatTrainingQueue.userId, ctx.userId),
            isNull(userStatTrainingQueue.completedAt),
            isNull(userStatTrainingQueue.cancelledAt),
          ),
          orderBy: asc(userStatTrainingQueue.startsAt),
        });
        for (const scheduled of rescheduleQueue(waiting, now)) {
          await tx
            .update(userStatTrainingQueue)
            .set({ startsAt: scheduled.startsAt, finishesAt: scheduled.finishesAt })
            .where(eq(userStatTrainingQueue.id, scheduled.entry.id));
        }
        return { statGain, stat: active.stat, trackers };
      });
      if (!result) return errorResponse("Not currently training");
      return {
        success: true,
        message: `You gained ${result.statGain.toFixed(2)} ${result.stat}`,
        data: {
          experience: result.statGain,
          currentlyTraining: result.stat,
          questData: result.trackers,
        },
        queue: await getStatTrainingQueue(ctx.drizzle, ctx.userId),
      };
    }),

  cancelQueuedTraining: protectedProcedure
    .input(z.object({ queueId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await prepareStatQueue(ctx.drizzle, ctx.userId);
      const now = new Date();
      const cancelled = await ctx.drizzle.transaction(async (tx) => {
        await tx
          .update(userData)
          .set({ updatedAt: sql`${userData.updatedAt}` })
          .where(eq(userData.userId, ctx.userId));
        const target = await tx.query.userStatTrainingQueue.findFirst({
          where: and(
            eq(userStatTrainingQueue.id, input.queueId),
            eq(userStatTrainingQueue.userId, ctx.userId),
            isNull(userStatTrainingQueue.completedAt),
            isNull(userStatTrainingQueue.cancelledAt),
            gt(userStatTrainingQueue.startsAt, now),
          ),
        });
        if (!target) return false;
        const result = await tx
          .update(userStatTrainingQueue)
          .set({ cancelledAt: now })
          .where(
            and(
              eq(userStatTrainingQueue.id, target.id),
              isNull(userStatTrainingQueue.cancelledAt),
            ),
          );
        if (result.rowsAffected !== 1) return false;
        const remaining = await tx.query.userStatTrainingQueue.findMany({
          where: and(
            eq(userStatTrainingQueue.userId, ctx.userId),
            isNull(userStatTrainingQueue.completedAt),
            isNull(userStatTrainingQueue.cancelledAt),
          ),
          orderBy: asc(userStatTrainingQueue.startsAt),
        });
        const active = remaining.find((entry) => entry.startsAt <= now);
        const waiting = remaining.filter((entry) => entry.startsAt > now);
        const cursor = active?.finishesAt ?? now;
        for (const scheduled of rescheduleQueue(waiting, cursor)) {
          await tx
            .update(userStatTrainingQueue)
            .set({ startsAt: scheduled.startsAt, finishesAt: scheduled.finishesAt })
            .where(eq(userStatTrainingQueue.id, scheduled.entry.id));
        }
        return true;
      });
      if (!cancelled) return errorResponse("Only waiting training can be cancelled");
      return {
        success: true,
        message: "Queued training cancelled",
        queue: await getStatTrainingQueue(ctx.drizzle, ctx.userId),
      };
    }),

  updateTrainingSpeed: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Update training speed interval" } })
    .input(z.object({ speed: z.enum(TrainingSpeeds) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      await prepareStatQueue(ctx.drizzle, ctx.userId);
      const queued = await ctx.drizzle.query.userStatTrainingQueue.findFirst({
        where: and(
          eq(userStatTrainingQueue.userId, ctx.userId),
          isNull(userStatTrainingQueue.completedAt),
          isNull(userStatTrainingQueue.cancelledAt),
        ),
      });
      if (queued)
        return errorResponse("Cannot change training speed while jobs are queued");
      const result = await ctx.drizzle
        .update(userData)
        .set({ trainingSpeed: input.speed })
        .where(eq(userData.userId, ctx.userId));
      return result.rowsAffected === 1
        ? { success: true, message: "Training speed updated" }
        : errorResponse("Could not update user");
    }),

  getTrainingLog: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Get user training history from last 24 hours",
      },
    })
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) =>
      ctx.drizzle.query.trainingLog.findMany({
        where: and(
          eq(trainingLog.userId, input.userId),
          gt(trainingLog.trainingFinishedAt, sql`NOW() - INTERVAL 1 DAY`),
        ),
      }),
    ),
});
