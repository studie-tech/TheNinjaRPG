import { and, eq, gt, gte, isNull, sql } from "drizzle-orm";
import {
  getUserCaps,
  MAX_DAILY_TRAININGS,
  type MasteryName,
  STATS_PER_ENERGY,
} from "@/drizzle/constants";
import { trainingLog, userData } from "@/drizzle/schema";
import { showTrainingCapcha } from "@/libs/captcha";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import {
  getEnergyQueue,
  getMasteryQueue,
  liveQueueRows,
  queueHeadAfter,
  toMasteryEntries,
} from "@/libs/queue";
import {
  calcMasteryTrainingAmount,
  getTrainingMultiplierBoost,
  masteryTrainingBlockMessage,
  queuedMasteryStartBlockMessage,
  statTrainingBlockMessage,
  trainingBoost,
  trainingEnergyMessage,
} from "@/libs/train";
import { validateCaptcha } from "@/routers/misc";
import type { UserWithRelations } from "@/routers/profile";
import { fetchUpdatedUser, getUserProgressionUpdate } from "@/routers/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { editTrainingQueue } from "@/server/utils/userQueue";
import { getQueueTotalCapacity, getQueueWaitingSlots } from "@/utils/paypal";
import { secondsPassed } from "@/utils/time";
import {
  startMasteryTrainingInputSchema,
  startTrainingInputSchema,
  stopTrainingInputSchema,
  trainingLogInputSchema,
  updateEnergyTrainingQueueInputSchema,
  updateMasteryTrainingQueueInputSchema,
  updateTrainingSpeedInputSchema,
} from "@/validators/train";
import { userDeltaResponseSchema } from "@/validators/userCache";

export const trainRouter = createTRPCRouter({
  updateEnergyTrainingQueue: protectedProcedure
    .input(updateEnergyTrainingQueueInputSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const { user, requiresProgressionRefresh, publishedAchievementIds } =
        await fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          forceRegen: true,
        });
      if (!user) return errorResponse("User not found");
      const result = await editTrainingQueue({
        client: ctx.drizzle,
        user,
        kind: "ENERGY",
        current: getEnergyQueue(user),
        expected: input.expectedEntries,
        entries: input.entries,
        validate: async () => {
          const block = statTrainingBlockMessage({
            ...user,
            status: user.status === "ASLEEP" ? "AWAKE" : user.status,
          });
          if (block) return block;
          if (input.entries.length > getQueueTotalCapacity(user))
            return "Training queue is full";
          if (input.entries.some((entry) => entry.energy > user.maxEnergy))
            return "Queued Energy cannot exceed your capacity";
          if (showTrainingCapcha(user)) {
            if (!input.guess) return "Captcha required";
            if (!(await validateCaptcha(ctx.drizzle, ctx.userId, input.guess)))
              return "Invalid captcha";
          }
          return null;
        },
        where: [eq(userData.status, user.status)],
        messages: {
          stale: "Your training queue changed. Please refresh and try again",
          conflict: "Your training queue changed. Please try again",
          saved: "Training queue saved",
          cleared: "Training queue cleared",
        },
      });
      return withSavedQueue(
        result,
        user,
        requiresProgressionRefresh,
        publishedAchievementIds,
      );
    }),

  updateMasteryTrainingQueue: protectedProcedure
    .meta({
      mcp: { description: "Replace the masteries queued behind mastery training" },
    })
    .input(updateMasteryTrainingQueueInputSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const { user, requiresProgressionRefresh, publishedAchievementIds } =
        await fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          forceRegen: true,
        });
      if (!user) return errorResponse("User not found");
      const result = await editTrainingQueue({
        client: ctx.drizzle,
        user,
        kind: "MASTERY",
        current: getMasteryQueue(user),
        expected: input.expectedEntries,
        entries: input.entries,
        // Adding or changing an entry needs an active session to queue behind.
        validate: () => {
          if (!user.currentlyTrainingMastery)
            return "Start a mastery training before queueing more";
          if (input.entries.length > getQueueWaitingSlots(user))
            return "Mastery queue is full";
          const { mastery_cap } = getUserCaps(user.rank);
          if (input.entries.some((entry) => user[entry.stat] >= mastery_cap))
            return "A queued mastery is already capped";
          return (
            input.entries
              .map((entry) => queuedMasteryStartBlockMessage(user, entry))
              .find(Boolean) ?? null
          );
        },
        messages: {
          stale: "Your mastery queue changed. Please refresh and try again",
          conflict: "Your mastery queue changed. Please try again",
          saved: "Mastery queue saved",
          cleared: "Mastery queue cleared",
        },
      });
      return withSavedQueue(
        result,
        user,
        requiresProgressionRefresh,
        publishedAchievementIds,
      );
    }),

  startTraining: protectedProcedure
    .meta({ mcp: { description: "Spend Energy to instantly train a combat stat" } })
    .input(startTrainingInputSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const { user, settings, requiresProgressionRefresh, publishedAchievementIds } =
        await fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          userIp: ctx.userIp,
          forceRegen: true,
        });
      if (!user) return errorResponse("User not found");
      const block =
        statTrainingBlockMessage(user) ??
        trainingEnergyMessage(input.energy, user.curEnergy);
      if (block) return errorResponse(block);
      if (showTrainingCapcha(user)) {
        if (!input.guess) return errorResponse("Captcha required");
        if (!(await validateCaptcha(ctx.drizzle, ctx.userId, input.guess)))
          return errorResponse("Invalid captcha");
      }
      const { stats_cap, gens_cap } = getUserCaps(user.rank);
      const cap =
        input.stat === "offence" || input.stat === "defence" ? stats_cap : gens_cap;
      const rate =
        STATS_PER_ENERGY *
        trainingBoost(user, settings) *
        getTrainingMultiplierBoost(user);
      const availableRoom = Math.max(0, cap - user[input.stat]);
      if (availableRoom === 0) return errorResponse("Already capped");
      if (input.energy > user.curEnergy) return errorResponse("Not enough Energy");
      const spent = Math.min(input.energy, availableRoom / rate);
      const amount = spent * rate;
      if (amount <= 0) return errorResponse("No training gains available");
      const { trackers, consequences, notifications } = getNewTrackers(user, [
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
          // Reject amounts lost to floating-point precision in the stored balance.
          sql`${userData.curEnergy} - ${spent} < ${userData.curEnergy}`,
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
        ...(!requiresProgressionRefresh && !consequences.length && !notifications.length
          ? getUserProgressionUpdate(
              {
                ...user,
                experience: Math.round(user.experience + amount),
                [input.stat]: user[input.stat] + amount,
                curEnergy: user.curEnergy - spent,
                questData: trackers,
                updatedAt: claim.claimedAt,
              },
              publishedAchievementIds,
            )
          : {}),
      };
    }),
  startMasteryTraining: protectedProcedure
    .meta({ mcp: { description: "Start training a mastery" } })
    .input(startMasteryTrainingInputSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const { user, requiresProgressionRefresh, publishedAchievementIds } =
        await fetchUpdatedUser({
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
      const claim = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: user.updatedAt,
        set: data,
        where: [
          isNull(userData.currentlyTrainingMastery),
          eq(userData.status, "AWAKE"),
          sql`${userData.dailyTrainings} < ${MAX_DAILY_TRAININGS}`,
        ],
      });
      if (!claim.success)
        return errorResponse("Your training changed. Please try again");
      return {
        success: true,
        message: "Started mastery training",
        ...(!requiresProgressionRefresh
          ? getUserProgressionUpdate(
              { ...user, ...data, updatedAt: claim.claimedAt },
              publishedAchievementIds,
            )
          : {}),
      };
    }),
  stopMasteryTraining: protectedProcedure
    .meta({
      mcp: { description: "Stop mastery training and collect gains" },
    })
    .input(stopTrainingInputSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const { user, settings, requiresProgressionRefresh, publishedAchievementIds } =
        await fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          forceRegen: true,
        });
      if (!user) return errorResponse("User not found");
      if (user.status !== "AWAKE") return errorResponse("Must be awake");
      const trained = user.currentlyTrainingMastery;
      const startedAt = user.masteryTrainingStartedAt;
      if (
        trained !== input.stat ||
        startedAt?.getTime() !== input.startedAt.getTime()
      ) {
        return errorResponse(
          "Your mastery training changed. Please refresh and try again",
        );
      }
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
      const trackerResult =
        creditedMinutes > 0
          ? getNewTrackers(user, [
              { task: "minutes_training", increment: creditedMinutes },
            ])
          : undefined;
      const trackers = trackerResult?.trackers ?? user.questData ?? [];
      const questData =
        creditedMinutes > 0
          ? filterQuestTrackersForDbPersist(trackers, user)
          : undefined;
      // The next queued mastery starts as this session is collected. Capped entries at
      // the front are dropped; one further back is dropped when it reaches the front.
      const queue = liveQueueRows(user.queue ?? [], "MASTERY", user.masteryQueueHead);
      const isCapped = (stat: MasteryName) =>
        (stat === trained ? user[trained] + gained : user[stat]) >= mastery_cap;
      let skipped = 0;
      while (queue[skipped] && isCapped(queue[skipped]?.stat as MasteryName)) skipped++;
      const nextRow = queue[skipped];
      const next = nextRow ? toMasteryEntries([nextRow])[0] : undefined;
      const startsNext =
        !!next &&
        !queuedMasteryStartBlockMessage(
          { ...user, dailyTrainings: user.dailyTrainings + (gained > 0 ? 1 : 0) },
          next,
        );
      const startedNextAt = new Date();
      const masteryQueueHead = queueHeadAfter(
        queue,
        skipped + (startsNext ? 1 : 0),
        user.masteryQueueHead,
      );
      // Claim exactly the session read above so concurrent collections cannot reuse it.
      const result = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: user.updatedAt,
        set: {
          masteryTrainingStartedAt: startsNext ? startedNextAt : null,
          currentlyTrainingMastery: startsNext ? next.stat : null,
          // Consumes the dropped entries and the one started, in this same write.
          masteryQueueHead,
          ...(startsNext ? { trainingSpeed: next.speed } : {}),
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
      const nextNote = startsNext ? `. Started queued ${next.stat} training` : "";
      return {
        success: true,
        message: `You gained ${gained.toFixed(2)} ${trained}${capNote}${nextNote}`,
        ...(!requiresProgressionRefresh &&
        !trackerResult?.consequences.length &&
        !trackerResult?.notifications.length
          ? getUserProgressionUpdate(
              {
                ...user,
                [trained]: user[trained] + gained,
                dailyTrainings: user.dailyTrainings + (gained > 0 ? 1 : 0),
                masteryTrainingStartedAt: startsNext ? startedNextAt : null,
                currentlyTrainingMastery: startsNext ? next.stat : null,
                trainingSpeed: startsNext ? next.speed : user.trainingSpeed,
                masteryQueueHead,
                questData: trackers,
                updatedAt: result.claimedAt,
              },
              publishedAchievementIds,
            )
          : {}),
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

/** Calculate timed mastery gains with the shared training bonuses. */
export const calcTrainingAmount = (
  user: NonNullable<UserWithRelations>,
  settings: Awaited<ReturnType<typeof fetchUpdatedUser>>["settings"],
  startedAt: Date,
) => ({
  trainingAmount: calcMasteryTrainingAmount(
    user,
    settings,
    secondsPassed(startedAt, undefined, false),
  ),
});

/** A queue edit's response, with the saved queue as a cache patch when it can be trusted. */
const withSavedQueue = (
  result: Awaited<ReturnType<typeof editTrainingQueue>>,
  user: NonNullable<Awaited<ReturnType<typeof fetchUpdatedUser>>["user"]>,
  requiresProgressionRefresh: boolean,
  publishedAchievementIds: readonly string[],
) => {
  if (!result.success) return errorResponse(result.message);
  return {
    success: true,
    message: result.message,
    ...(!requiresProgressionRefresh
      ? getUserProgressionUpdate({ ...user, ...result.saved }, publishedAchievementIds)
      : {}),
  };
};
