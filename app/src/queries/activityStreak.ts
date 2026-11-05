/**
 * Database access for activity streak; authorization and transaction scopes stay in callers.
 */
import type { SQL } from "drizzle-orm";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { COST_STREAK_CATCHUP_DAY } from "@/drizzle/constants";
import {
  actionLog,
  activityStreakConfig,
  activityStreakReward,
  userData,
  userStreakProgress,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import type {
  ActivityStreakConfigInput,
  ActivityStreakConfigUpdateInput,
  StreakDayRewardType,
} from "@/validators/activityStreak";

/** Build the `userStreakProgress` listing for `getUserStreaks`, using predicates on `userId`. */
export const listUserStreakProgressForGetUserStreaks = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userStreakProgress.findMany({
    where: eq(userStreakProgress.userId, ctx.userId),
    with: {
      config: {
        with: {
          rewards: true,
        },
      },
    },
  });

/** Build the `activityStreakConfig` lookup for `getUserStreaks`, using predicates on `streakType` and `isActive`. */
export const findActivityStreakConfigForGetUserStreaks = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.activityStreakConfig.findFirst({
    where: and(
      eq(activityStreakConfig.streakType, "RECURRING"),
      eq(activityStreakConfig.isActive, true),
    ),
    with: {
      rewards: true,
    },
  });

/** Build the `actionLog` listing for `getUserStreaks`, using predicates on `userId` and `tableName`. */
export const listActionLogForGetUserStreaks = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.actionLog.findMany({
    where: and(
      eq(actionLog.userId, ctx.userId),
      eq(actionLog.tableName, "activityStreak"),
    ),
    columns: { relatedId: true, changes: true, createdAt: true },
  });

/** Build the `activityStreakConfig` listing for `getAvailablePasses`, using predicates on `streakType` and `isActive`. */
export const listActivityStreakConfigForGetAvailablePasses = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.activityStreakConfig.findMany({
    where: and(
      eq(activityStreakConfig.streakType, "EVENT_PASS"),
      eq(activityStreakConfig.isActive, true),
    ),
    with: {
      rewards: true,
    },
  });

/**
 * Build the `userStreakProgress` listing for `getAvailablePasses`, selecting only
 * `configId`, using predicates on `userId`.
 */
export const listUserStreakProgressForGetAvailablePasses = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userStreakProgress.findMany({
    where: eq(userStreakProgress.userId, ctx.userId),
    columns: { configId: true },
  });

/**
 * Build the `actionLog` listing for `getAvailablePasses`, selecting only `relatedId`
 * and `changes`, using predicates on `userId` and `tableName`.
 */
export const listActionLogForGetAvailablePasses = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.actionLog.findMany({
    where: and(
      eq(actionLog.userId, ctx.userId),
      eq(actionLog.tableName, "activityStreak"),
    ),
    columns: { relatedId: true, changes: true },
  });

/** Build an activity streak configuration lookup by ID. */
export const findActivityStreakConfigById = (
  client: Pick<DrizzleClient, "query">,
  id: string,
) =>
  client.query.activityStreakConfig.findFirst({
    where: eq(activityStreakConfig.id, id),
  });

/** Build the progress lookup for one user and streak configuration. */
export const findUserStreakProgress = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
  configId: string,
) =>
  client.query.userStreakProgress.findFirst({
    where: and(
      eq(userStreakProgress.userId, userId),
      eq(userStreakProgress.configId, configId),
    ),
  });

/**
 * Build the `actionLog` listing for `purchaseEventPass`, selecting only `changes`,
 * using predicates on `userId`, `relatedId`, `tableName`.
 */
export const listActionLogForPurchaseEventPass = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
  input: { configId: string },
) =>
  client.query.actionLog.findMany({
    where: and(
      eq(actionLog.userId, ctx.userId),
      eq(actionLog.relatedId, input.configId),
      eq(actionLog.tableName, "activityStreak"),
    ),
    columns: { changes: true },
  });

/** Build the `userData` update for `purchaseEventPass`, including predicates on `userId`, `money`, `reputationPoints`. */
export const updateUserDataForPurchaseEventPass = (
  client: Pick<DrizzleClient, "update">,
  config: { ryoCost: number; repsCost: number; seichiSilverCost: number },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      money: sql`${userData.money} - ${config.ryoCost}`,
      reputationPoints: sql`${userData.reputationPoints} - ${config.repsCost}`,
      seichiSilver: sql`${userData.seichiSilver} - ${config.seichiSilverCost}`,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        gte(userData.money, config.ryoCost),
        gte(userData.reputationPoints, config.repsCost),
        gte(userData.seichiSilver, config.seichiSilverCost),
      ),
    );

/** Build the `userStreakProgress` insert for `purchaseEventPass`, updating duplicate keys. */
export const insertUserStreakProgressForPurchaseEventPass = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  config: { id: string },
) =>
  client
    .insert(userStreakProgress)
    .values({
      id: nanoid(),
      userId: ctx.userId,
      configId: config.id,
      currentDay: 0,
      lastClaimDate: null,
      startedAt: new Date(),
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/** Build the `userData` update for `purchaseEventPass`, using predicates on `userId`. */
export const updateUserDataForPurchaseEventPass2 = (
  client: Pick<DrizzleClient, "update">,
  config: { ryoCost: number; repsCost: number; seichiSilverCost: number },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      money: sql`${userData.money} + ${config.ryoCost}`,
      reputationPoints: sql`${userData.reputationPoints} + ${config.repsCost}`,
      seichiSilver: sql`${userData.seichiSilver} + ${config.seichiSilverCost}`,
    })
    .where(eq(userData.userId, ctx.userId));

/** Build the `activityStreakConfig` lookup for `claimStreakDay`, using predicates on `id`. */
export const findActivityStreakConfigForClaimStreakDay = (
  client: Pick<DrizzleClient, "query">,
  input: { configId: string },
) =>
  client.query.activityStreakConfig.findFirst({
    where: eq(activityStreakConfig.id, input.configId),
    with: { rewards: true },
  });

/**
 * Build the `actionLog` listing for `claimStreakDay`, selecting only `changes` and
 * `createdAt`, using predicates on `userId`, `relatedId`, `tableName`.
 */
export const listActionLogForClaimStreakDay = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
  input: { configId: string },
) =>
  client.query.actionLog.findMany({
    where: and(
      eq(actionLog.userId, ctx.userId),
      eq(actionLog.relatedId, input.configId),
      eq(actionLog.tableName, "activityStreak"),
    ),
    columns: { changes: true, createdAt: true },
  });

/** Build the `userStreakProgress` insert for `claimStreakDay`. */
export const insertUserStreakProgressForClaimStreakDay = (
  client: Pick<DrizzleClient, "insert">,
  createdProgress: Pick<
    import("@/drizzle/schema").UserStreakProgress,
    "id" | "userId" | "startedAt" | "configId" | "currentDay"
  > & { lastClaimDate: null },
) => client.insert(userStreakProgress).values(createdProgress);

/**
 * Build the `userStreakProgress` update for `claimStreakDay`, setting `currentDay` and
 * `lastClaimDate`, using predicates on `id` and `lastClaimDate`.
 */
export const updateUserStreakProgressForClaimStreakDay = (
  client: Pick<DrizzleClient, "update">,
  newCurrentDay: number,
  now: Date,
  streakReset: false | true,
  normalizedCompletion: false | true,
  config: { streakType: "RECURRING" | "EVENT_PASS" },
  progress: { currentDay: number; id: string; lastClaimDate: null | Date },
) =>
  client
    .update(userStreakProgress)
    .set({
      currentDay: newCurrentDay,
      lastClaimDate: now,
      // A recurring cycle starts with its first claim, not the previous
      // cycle's completion; otherwise day one immediately appears behind.
      ...((streakReset ||
        normalizedCompletion ||
        (config.streakType === "RECURRING" && progress.currentDay === 0)) && {
        startedAt: now,
      }),
    })
    .where(
      and(
        eq(userStreakProgress.id, progress.id),
        progress.lastClaimDate === null
          ? isNull(userStreakProgress.lastClaimDate)
          : eq(userStreakProgress.lastClaimDate, progress.lastClaimDate),
      ),
    );

/**
 * Build the `userData` update for `claimStreakDay`, setting `reputationPoints`, using
 * predicates on `userId` and `reputationPoints`.
 */
export const updateUserDataForClaimStreakDay = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      reputationPoints: sql`${userData.reputationPoints} - ${COST_STREAK_CATCHUP_DAY}`,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        gte(userData.reputationPoints, COST_STREAK_CATCHUP_DAY),
      ),
    );

/**
 * Build the `userStreakProgress` update for `claimStreakDay`, setting `currentDay` and
 * `lastClaimDate`, using predicates on `id`.
 */
export const updateUserStreakProgressForClaimStreakDay2 = (
  client: Pick<DrizzleClient, "update">,
  progress: {
    currentDay: number;
    lastClaimDate: null | Date;
    startedAt: Date;
    id: string;
  },
  streakReset: false | true,
) =>
  client
    .update(userStreakProgress)
    .set({
      currentDay: progress.currentDay,
      lastClaimDate: progress.lastClaimDate,
      ...(streakReset && { startedAt: progress.startedAt }),
    })
    .where(eq(userStreakProgress.id, progress.id));

/** Build the `actionLog` insert for `claimStreakDay`. */
export const insertActionLogForClaimStreakDay = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  config: {
    name: string;
    streakType: "RECURRING" | "EVENT_PASS";
    id: string;
    image: null | string;
  },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "activityStreak",
    changes: [`Completed ${config.name} (${config.streakType})`],
    relatedId: config.id,
    relatedMsg: `Streak completed: ${config.name}`,
    relatedImage: config.image,
  });

/**
 * Build the `userStreakProgress` update for `claimStreakDay`, setting `currentDay` and
 * `startedAt`, using predicates on `id`.
 */
export const updateUserStreakProgressForClaimStreakDay3 = (
  client: Pick<DrizzleClient, "update">,
  now: Date,
  progress: { id: string },
) =>
  client
    .update(userStreakProgress)
    .set({ currentDay: 0, startedAt: now })
    .where(eq(userStreakProgress.id, progress.id));

/** Build the `activityStreakConfig` listing for `getConfigs`, using the configured predicates. */
export const listActivityStreakConfigForGetConfigs = (
  client: Pick<DrizzleClient, "query">,
  whereClause: undefined | SQL<unknown>,
) =>
  client.query.activityStreakConfig.findMany({
    where: whereClause,
    orderBy: [desc(activityStreakConfig.createdAt)],
    with: {
      rewards: true,
    },
  });

/** Build the `activityStreakConfig` lookup for `getConfig`, using predicates on `id`. */
export const findActivityStreakConfigForGetConfig = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.activityStreakConfig.findFirst({
    where: eq(activityStreakConfig.id, input.id),
    with: {
      rewards: {
        orderBy: [activityStreakReward.dayNumber],
      },
    },
  });

/** Build the `activityStreakConfig` insert for `createConfig`. */
export const insertActivityStreakConfigForCreateConfig = (
  client: Pick<DrizzleClient, "insert">,
  configId: string,
  input: Omit<ActivityStreakConfigInput, "rewards">,
  ctx: { userId: string },
) =>
  client.insert(activityStreakConfig).values({
    id: configId,
    ...toConfigColumns(input),
    createdByUserId: ctx.userId,
  });

/** Build the `activityStreakConfig` update for `updateConfig`, using predicates on `id`. */
export const updateActivityStreakConfigForUpdateConfig = (
  client: Pick<DrizzleClient, "update">,
  input: Omit<ActivityStreakConfigUpdateInput, "rewards">,
) =>
  client
    .update(activityStreakConfig)
    .set({
      ...toConfigColumns(input),
      updatedAt: new Date(),
    })
    .where(eq(activityStreakConfig.id, input.id));

/** Build the `activityStreakReward` deletion for `updateConfig`, using predicates on `configId`. */
export const deleteActivityStreakRewardForUpdateConfig = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) =>
  client
    .delete(activityStreakReward)
    .where(eq(activityStreakReward.configId, input.id));

/** Build the `userStreakProgress` deletion for `deleteConfig`, using predicates on `configId`. */
export const deleteUserStreakProgressForDeleteConfig = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(userStreakProgress).where(eq(userStreakProgress.configId, input.id));

/** Build the `activityStreakConfig` deletion for `deleteConfig`, using predicates on `id`. */
export const deleteActivityStreakConfigForDeleteConfig = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(activityStreakConfig).where(eq(activityStreakConfig.id, input.id));

/** Insert the configured streak-day rewards with generated row IDs after the caller has saved the configuration. */
export const createRewardsForConfig = async (
  client: DrizzleClient,
  configId: string,
  rewards: StreakDayRewardType[],
) => {
  await client.insert(activityStreakReward).values(
    rewards.map((reward) => ({
      id: nanoid(),
      configId,
      dayNumber: reward.dayNumber,
      rewards: reward.rewards,
      image: reward.image ?? null,
    })),
  );
};

/** Config columns shared by the insert and the update; absent optionals clear the column. */
const toConfigColumns = (input: Omit<ActivityStreakConfigInput, "rewards">) => ({
  name: input.name,
  description: input.description ?? null,
  image: input.image ?? null,
  totalDays: input.totalDays,
  streakType: input.streakType,
  isActive: input.isActive,
  ryoCost: input.ryoCost,
  repsCost: input.repsCost,
  seichiSilverCost: input.seichiSilverCost,
  startDate: input.startDate ?? null,
  endDate: input.endDate ?? null,
});
