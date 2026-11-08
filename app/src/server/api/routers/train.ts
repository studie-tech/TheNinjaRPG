import * as Sentry from "@sentry/nextjs";
import { eq, gte, isNull, lt, sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { getUserProgressionUpdate } from "@/deltas/profile";
import {
  getSavedTrainingQueueUserUpdate,
  getSelectTrainedElementUserUpdate,
} from "@/deltas/train";
import {
  BasicElementName,
  getCombatStatCap,
  getUserCaps,
  MASTERY_QUEUE_KIND_LABELS,
  MAX_DAILY_TRAININGS,
  MasteryNames,
  MasteryQueueKinds,
  QUEUE_WAITING_SLOTS,
  type TimedMasteryName,
  TimedMasteryNames,
  TrainingSpeeds,
} from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";
import { actionStatusMessage } from "@/libs/actionReadiness";
import { activeTrainedElement } from "@/libs/elementalMastery";
import { petExperienceGainSql } from "@/libs/pets/experience";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import {
  getEnergyQueue,
  getMasteryQueue,
  isOrderedSubsequence,
  liveQueueRows,
  queueHeadAfter,
  toMasteryEntries,
} from "@/libs/queue";
import {
  applyMasteryTrainingGains,
  calcMasteryTrainingAmount,
  getMasteryTrainingState,
  masteryTrainingBlockMessage,
  masteryTrainingFields,
  masteryTrainingGainRoom,
  masteryTrainingSessionUpdate,
  queuedMasteryStartBlockMessage,
  statsPerEnergy,
  statTrainingBlockMessage,
  trainingEnergyMessage,
} from "@/libs/train";
import { fetchActionUser } from "@/queries/actionReadiness";
import { fetchAllGameSettings } from "@/queries/profile";
import {
  insertTrainingLog,
  listTrainingLogForGetTrainingLog,
  updateUserDataForUpdateTrainingSpeed,
} from "@/queries/train";
import { trainingCaptchaMessage } from "@/routers/misc";
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
import { claimUserSnapshot } from "@/server/utils/concurrency";
import {
  elementalSnapshotConditions,
  masteryGainUpdates,
} from "@/server/utils/masteryProgression";
import { flushSafe } from "@/server/utils/sentry";
import { editTrainingQueue } from "@/server/utils/userQueue";
import { isInArray } from "@/utils/array";
import { getQueueTotalCapacity, getQueueWaitingSlots } from "@/utils/paypal";
import { secondsPassed } from "@/utils/time";
import {
  energyTrainingQueueEntrySchema,
  masteryTrainingQueueEntrySchema,
  startTrainingInputSchema,
} from "@/validators/train";
import { userDeltaResponseSchema } from "@/validators/userCache";

const updateEnergyTrainingQueueInputSchema = z.object({
  entries: z.array(energyTrainingQueueEntrySchema).max(1 + QUEUE_WAITING_SLOTS.GOLD),
  expectedEntries: z
    .array(energyTrainingQueueEntrySchema)
    .max(1 + QUEUE_WAITING_SLOTS.GOLD),
  guess: z.string().optional(),
});

const updateMasteryTrainingQueueInputSchema = z.object({
  kind: z.enum(MasteryQueueKinds).default("MASTERY"),
  entries: z.array(masteryTrainingQueueEntrySchema).max(QUEUE_WAITING_SLOTS.GOLD),
  expectedEntries: z
    .array(masteryTrainingQueueEntrySchema)
    .max(QUEUE_WAITING_SLOTS.GOLD),
});

const startMasteryTrainingInputSchema = z.object({
  stat: z.enum(TimedMasteryNames),
  speed: z.enum(TrainingSpeeds).optional(),
});

const stopTrainingInputSchema = z.object({
  stat: z.enum(TimedMasteryNames),
  startedAt: z.date(),
  guess: z.string().optional(),
});

const updateTrainingSpeedInputSchema = z.object({
  speed: z.enum(TrainingSpeeds),
});

const trainingLogInputSchema = z.object({
  userId: z.string(),
});

const selectTrainedElementSchema = z.object({
  element: z.enum(BasicElementName).nullable(),
});

export const trainRouter = createTRPCRouter({
  selectTrainedElement: protectedProcedure
    .input(selectTrainedElementSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [initialUser, settings] = await Promise.all([
        fetchActionUser(ctx.drizzle, ctx.userId),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      if (
        input.element &&
        !activeTrainedElement({ ...user, activeTrainedElement: input.element })
      )
        return errorResponse(
          "Choose a fully mastered element not provided innately or by your bloodline",
        );
      const result = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: user.updatedAt,
        readiness,
        set: { activeTrainedElement: input.element },
        where: elementalSnapshotConditions(initialUser),
      });
      return actionReadinessResponse(
        result.success
          ? {
              success: true,
              message: "Active trained element updated",
              ...getSelectTrainedElementUserUpdate({
                inputElement: input.element,
                resultClaimedAt: result.claimedAt,
              }),
            }
          : errorResponse("Your elements changed. Please try again"),
        result.success ? readiness : undefined,
        ctx.drizzle,
      );
    }),
  updateEnergyTrainingQueue: protectedProcedure
    .input(updateEnergyTrainingQueueInputSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const {
        user: initialUser,
        settings,
        requiresProgressionRefresh,
        publishedAchievementIds,
      } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        forceRegen: true,
      });
      if (!initialUser) return errorResponse("User not found");
      // Pure removals preserve the current activity without preparing an action recovery.
      const readiness = !isOrderedSubsequence(input.entries, input.expectedEntries)
        ? prepareActionReadiness(initialUser, settings)
        : undefined;
      if (readiness?.error) return errorResponse(readiness.error);
      const user = readiness?.user ?? initialUser;
      const result = await editTrainingQueue({
        client: ctx.drizzle,
        user,
        kind: "ENERGY",
        current: getEnergyQueue(user),
        expected: input.expectedEntries,
        entries: input.entries,
        validate: async () => {
          const block = statTrainingBlockMessage(user);
          if (block) return block;
          if (input.entries.length > getQueueTotalCapacity(user))
            return "Training queue is full";
          if (input.entries.some((entry) => entry.energy > user.maxEnergy))
            return "Queued Energy cannot exceed your capacity";
          return await trainingCaptchaMessage(ctx.drizzle, user, input.guess);
        },
        readiness,
        where: [readiness ? undefined : eq(userData.status, initialUser.status)],
        messages: {
          stale: "Your training queue changed. Please refresh and try again",
          conflict: "Your training queue changed. Please try again",
          saved: "Training queue saved",
          cleared: "Training queue cleared",
        },
      });
      return actionReadinessResponse(
        withSavedQueue(
          result,
          user,
          requiresProgressionRefresh,
          publishedAchievementIds,
        ),
        result.success ? readiness : undefined,
        ctx.drizzle,
      );
    }),

  updateMasteryTrainingQueue: protectedProcedure
    .meta({
      mcp: { description: "Replace the masteries queued behind mastery training" },
    })
    .input(updateMasteryTrainingQueueInputSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const {
        user: initialUser,
        settings,
        requiresProgressionRefresh,
        publishedAchievementIds,
      } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        forceRegen: true,
      });
      if (!initialUser) return errorResponse("User not found");
      // Pure removals preserve the current activity without preparing an action recovery.
      const readiness = !isOrderedSubsequence(input.entries, input.expectedEntries)
        ? prepareActionReadiness(initialUser, settings)
        : undefined;
      if (readiness?.error) return errorResponse(readiness.error);
      const user = readiness?.user ?? initialUser;
      const session = getMasteryTrainingState(user, input.kind);
      const label = MASTERY_QUEUE_KIND_LABELS[input.kind];
      if (
        [...input.entries, ...input.expectedEntries].some(
          (entry) =>
            isInArray(entry.stat, BasicElementName) !== (input.kind === "ELEMENT"),
        )
      )
        return errorResponse("Training target does not belong to this queue");
      const result = await editTrainingQueue({
        client: ctx.drizzle,
        user,
        kind: input.kind,
        current: getMasteryQueue(user, input.kind),
        expected: input.expectedEntries,
        entries: input.entries,
        // Adding or changing an entry needs an active session to queue behind.
        validate: () => {
          if (user.status !== "AWAKE") return actionStatusMessage(user.status);
          if (!session.stat) return "Start training in this queue before queueing more";
          if (input.entries.length > getQueueWaitingSlots(user))
            return `${label} queue is full`;
          if (
            input.entries.some(
              (entry) => masteryTrainingGainRoom(user, entry.stat) <= 0,
            )
          )
            return input.kind === "ELEMENT"
              ? "A queued element is already provided or fully mastered"
              : "A queued mastery is already capped";
          return (
            input.entries
              .map((entry) => queuedMasteryStartBlockMessage(user, entry))
              .find(Boolean) ?? null
          );
        },
        readiness,
        where: [
          readiness ? undefined : eq(userData.status, initialUser.status),
          ...elementalSnapshotConditions(user),
        ],
        messages: {
          stale: `Your ${label.toLowerCase()} queue changed. Please refresh and try again`,
          conflict: `Your ${label.toLowerCase()} queue changed. Please try again`,
          saved: `${label} queue saved`,
          cleared: `${label} queue cleared`,
        },
      });
      return actionReadinessResponse(
        withSavedQueue(
          result,
          user,
          requiresProgressionRefresh,
          publishedAchievementIds,
        ),
        result.success ? readiness : undefined,
        ctx.drizzle,
      );
    }),

  startTraining: protectedProcedure
    .meta({ mcp: { description: "Spend Energy to instantly train a combat stat" } })
    .input(startTrainingInputSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const {
        user: initialUser,
        settings,
        requiresProgressionRefresh,
        publishedAchievementIds,
      } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        userIp: ctx.userIp,
        forceRegen: true,
      });
      if (!initialUser) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      const block =
        statTrainingBlockMessage(user) ??
        trainingEnergyMessage(input.energy, user.curEnergy);
      if (block) return errorResponse(block);
      const captchaBlock = await trainingCaptchaMessage(ctx.drizzle, user, input.guess);
      if (captchaBlock) return errorResponse(captchaBlock);
      const cap = getCombatStatCap(getUserCaps(user.rank), input.stat);
      const rate = statsPerEnergy(user, settings);
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
        readiness,
        set: {
          curEnergy: readiness.notice
            ? user.curEnergy - spent
            : sql`${userData.curEnergy} - ${spent}`,
          [input.stat]: sql`${userData[input.stat]} + ${amount}`,
          experience: sql`${userData.experience} + ${amount}`,
          petExperience: petExperienceGainSql(amount),
          questData: filterQuestTrackersForDbPersist(trackers, user),
        },
        where: [
          readiness.notice
            ? eq(userData.curEnergy, initialUser.curEnergy)
            : gte(userData.curEnergy, spent),
          // Reject amounts lost to floating-point precision in the stored balance.
          readiness.notice
            ? sql`${user.curEnergy} - ${spent} < ${user.curEnergy}`
            : sql`${userData.curEnergy} - ${spent} < ${userData.curEnergy}`,
          sql`${userData[input.stat]} + ${amount} <= ${cap}`,
        ],
      });
      if (!claim.success)
        return errorResponse("Your stats or Energy changed. Please try again");
      const trainingFinishedAt = new Date();
      // History is independent of the committed gains; keep it off the response path.
      after(async () => {
        try {
          await insertTrainingLog(
            ctx.drizzle,
            ctx.userId,
            amount,
            input.stat,
            user.trainingSpeed,
            trainingFinishedAt,
          );
        } catch (error) {
          Sentry.captureException(error, {
            tags: { source: "train.startTraining.trainingLog" },
          });
          await flushSafe();
        }
      });
      return actionReadinessResponse(
        {
          success: true,
          message: `You gained ${amount.toFixed(2)} ${input.stat}`,
          ...(!requiresProgressionRefresh &&
          !consequences.length &&
          !notifications.length
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
        },
        readiness,
        ctx.drizzle,
      );
    }),
  startMasteryTraining: protectedProcedure
    .meta({ mcp: { description: "Start training a mastery" } })
    .input(startMasteryTrainingInputSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const {
        user: initialUser,
        settings,
        requiresProgressionRefresh,
        publishedAchievementIds,
      } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        userIp: ctx.userIp,
        forceRegen: true,
      });
      if (!initialUser) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      const kind = isInArray(input.stat, BasicElementName) ? "ELEMENT" : "MASTERY";
      const fields = masteryTrainingFields[kind];
      const session = getMasteryTrainingState(user, kind);
      const speed = kind === "ELEMENT" ? (input.speed ?? session.speed) : session.speed;
      const block = masteryTrainingBlockMessage(user, { ...session, speed });
      if (block) return errorResponse(block);
      if (masteryTrainingGainRoom(user, input.stat) <= 0)
        return errorResponse(
          isInArray(input.stat, BasicElementName)
            ? "Element is already provided or fully mastered"
            : "Mastery capped. Complete its rank-up quest or free space under the total cap.",
        );
      const data = masteryTrainingSessionUpdate(kind, {
        startedAt: new Date(),
        stat: input.stat,
        speed,
      });
      const claim = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: user.updatedAt,
        readiness,
        set: data,
        where: [
          ...elementalSnapshotConditions(user),
          isNull(userData[fields.stat]),
          lt(userData.dailyTrainings, MAX_DAILY_TRAININGS),
        ],
      });
      if (!claim.success)
        return errorResponse("Your training changed. Please try again");
      return actionReadinessResponse(
        {
          success: true,
          message: `Started ${MASTERY_QUEUE_KIND_LABELS[kind].toLowerCase()} training`,
          ...(!requiresProgressionRefresh
            ? getUserProgressionUpdate(
                { ...user, ...data, updatedAt: claim.claimedAt },
                publishedAchievementIds,
              )
            : {}),
        },
        readiness,
        ctx.drizzle,
      );
    }),
  stopMasteryTraining: protectedProcedure
    .meta({
      mcp: { description: "Stop mastery training and collect gains" },
    })
    .input(stopTrainingInputSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const {
        user: initialUser,
        settings,
        requiresProgressionRefresh,
        publishedAchievementIds,
      } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        forceRegen: true,
      });
      if (!initialUser) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      const kind = isInArray(input.stat, BasicElementName) ? "ELEMENT" : "MASTERY";
      const fields = masteryTrainingFields[kind];
      const { stat: trained, startedAt, speed } = getMasteryTrainingState(user, kind);
      if (
        !startedAt ||
        trained !== input.stat ||
        startedAt.getTime() !== input.startedAt.getTime()
      ) {
        return errorResponse(
          `Your ${MASTERY_QUEUE_KIND_LABELS[kind].toLowerCase()} training changed. Please refresh and try again`,
        );
      }
      const captchaBlock = await trainingCaptchaMessage(ctx.drizzle, user, input.guess);
      if (captchaBlock) return errorResponse(captchaBlock);
      const trainingAmount = calcMasteryTrainingAmount(
        { ...user, trainingSpeed: speed },
        settings,
        secondsPassed(startedAt, undefined, false),
      );
      const gained =
        user.dailyTrainings < MAX_DAILY_TRAININGS
          ? Math.max(
              0,
              Math.min(trainingAmount, masteryTrainingGainRoom(user, trained)),
            )
          : 0;
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
      const queue = liveQueueRows(user.queue ?? [], kind, user[fields.head]);
      const balances = applyMasteryTrainingGains(user, { [trained]: gained });
      const isCapped = (stat: TimedMasteryName) =>
        masteryTrainingGainRoom({ ...user, ...balances }, stat) <= 0;
      let skipped = 0;
      while (queue[skipped] && isCapped(queue[skipped]?.stat as TimedMasteryName))
        skipped++;
      const nextRow = queue[skipped];
      const next = nextRow ? toMasteryEntries([nextRow])[0] : undefined;
      const startsNext =
        !!next &&
        !queuedMasteryStartBlockMessage(
          { ...user, dailyTrainings: user.dailyTrainings + (gained > 0 ? 1 : 0) },
          next,
        );
      const startedNextAt = new Date();
      const head = queueHeadAfter(
        queue,
        skipped + (startsNext ? 1 : 0),
        user[fields.head],
      );
      const sessionUpdate = {
        ...masteryTrainingSessionUpdate(kind, {
          stat: startsNext ? next.stat : null,
          startedAt: startsNext ? startedNextAt : null,
          speed: startsNext ? next.speed : speed,
        }),
        [fields.head]: head,
      };
      // Claim exactly the session read above so concurrent collections cannot reuse it.
      const result = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: user.updatedAt,
        readiness,
        set: {
          ...sessionUpdate,
          ...(gained > 0
            ? {
                dailyTrainings: sql`${userData.dailyTrainings} + 1`,
                // Apply both live progression caps without lowering stored entitlement;
                // the snapshot guards keep the gain and queued-session handoff consistent.
                ...masteryGainUpdates({ [trained]: gained }),
                elementalMastery: balances.elementalMastery,
              }
            : {}),
          ...(questData ? { questData } : {}),
        },
        where: [
          ...(gained > 0 ? [lt(userData.dailyTrainings, MAX_DAILY_TRAININGS)] : []),
          ...MasteryNames.map((stat) => eq(userData[stat], user[stat])),
          ...elementalSnapshotConditions(user),
          sql`${userData.masteryRanks} = CAST(${JSON.stringify(user.masteryRanks)} AS JSON)`,
          eq(userData[fields.stat], trained),
          eq(userData[fields.startedAt], startedAt),
        ],
      });
      if (!result.success) {
        return errorResponse("Training changed while stopping. Please try again");
      }
      if (gained > 0) {
        const trainingFinishedAt = new Date();
        after(async () => {
          try {
            await insertTrainingLog(
              ctx.drizzle,
              ctx.userId,
              gained,
              trained,
              speed,
              trainingFinishedAt,
            );
          } catch (error) {
            Sentry.captureException(error, {
              tags: { source: "train.stopMasteryTraining.trainingLog" },
            });
            await flushSafe();
          }
        });
      }
      const capNote =
        gained < trainingAmount ? " (training cap or eligibility reached)" : "";
      const nextNote = startsNext ? `. Started queued ${next.stat} training` : "";
      return actionReadinessResponse(
        {
          success: true,
          message: `You gained ${gained.toFixed(2)} ${trained}${capNote}${nextNote}`,
          ...(!requiresProgressionRefresh &&
          !trackerResult?.consequences.length &&
          !trackerResult?.notifications.length
            ? getUserProgressionUpdate(
                {
                  ...user,
                  ...balances,
                  dailyTrainings: user.dailyTrainings + (gained > 0 ? 1 : 0),
                  ...sessionUpdate,
                  questData: trackers,
                  updatedAt: result.claimedAt,
                },
                publishedAchievementIds,
              )
            : {}),
        },
        readiness,
        ctx.drizzle,
      );
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
      const result = await updateUserDataForUpdateTrainingSpeed(
        ctx.drizzle,
        input,
        ctx,
      );
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
      return listTrainingLogForGetTrainingLog(ctx.drizzle, input);
    }),
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
    ...getSavedTrainingQueueUserUpdate({
      user,
      saved: result.saved,
      requiresProgressionRefresh,
      publishedAchievementIds,
    }),
  };
};
