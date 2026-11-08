/**
 * Database access for train; authorization and transaction scopes stay in callers.
 */

import { and, asc, eq, gt, inArray, isNotNull, lte, type SQL, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  CombatStatName,
  QueueKind,
  TimedMasteryName,
  TrainingSpeed,
} from "@/drizzle/constants";
import {
  jutsu,
  trainingLog,
  userCookingJob,
  userData,
  userItem,
  userJutsu,
  userQueue,
} from "@/drizzle/schema";
import { getCookingExperience } from "@/libs/cooking";
import { nextSnapshotSql } from "@/queries/concurrency";
import type { DrizzleClient } from "@/server/db";
import {
  completedQuestHistoryRelation,
  userQuestHistoryRelation,
} from "@/server/utils/achievementObjectives";
import { territoryWarBoostWindowsSql } from "@/server/utils/territoryWar";

/** Build the `userQueue` listing for `fetchJutsuTrainingQueue`. */
export const listUserQueueForFetchJutsuTrainingQueue = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userQueue.findMany({
    where: queueOf(userId, "JUTSU"),
    orderBy: asc(userQueue.position),
    with: { jutsu: true },
  });

/** Build the `userQueue` listing for `fetchCraftingQueue`. */
export const listUserQueueForFetchCraftingQueue = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userQueue.findMany({
    where: queueOf(userId, "CRAFT"),
    orderBy: asc(userQueue.position),
    with: { item: true },
  });

/**
 * Waiting jutsu levels for display, in queue order, each with the jutsu's name and the
 * level the user owns now, in one query.
 */
export const fetchJutsuQueueSummary = (client: DrizzleClient, userId: string) =>
  client
    .select({
      id: userQueue.id,
      kind: userQueue.kind,
      jutsuId: userQueue.jutsuId,
      startsAt: userQueue.startsAt,
      name: jutsu.name,
      ownedLevel: userJutsu.level,
    })
    .from(userQueue)
    .leftJoin(jutsu, eq(userQueue.jutsuId, jutsu.id))
    .leftJoin(
      userJutsu,
      and(
        eq(userJutsu.userId, userQueue.userId),
        eq(userJutsu.jutsuId, userQueue.jutsuId),
      ),
    )
    .where(queueOf(userId, "JUTSU"))
    .orderBy(asc(userQueue.position));

/** Build the `userQueue` selection for `fetchQueuedJutsuIds`. */
export const selectUserQueueForFetchQueuedJutsuIds = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({ jutsuId: userQueue.jutsuId })
    .from(userQueue)
    .where(queueOf(userId, "JUTSU"));

/** Build the `userQueue` selection for `appendQueueEntries`. */
export const selectUserQueueForAppendQueueEntries = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
  kind: "JUTSU" | "CRAFT",
) =>
  client
    .select({ position: sql<number>`COALESCE(MAX(${userQueue.position}), 0)` })
    .from(userQueue)
    .where(queueOf(userId, kind));

/** Build deletion of consumed or replaced MASTERY, ELEMENT or ENERGY rows at or below the head. */
export const deleteDeadQueueRows = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
  kind: "MASTERY" | "ENERGY" | "ELEMENT",
  head: number,
) =>
  client
    .delete(userQueue)
    .where(and(queueOf(userId, kind), lte(userQueue.position, head)));

/** Build insertion of caller-prepared queue rows. */
export const insertUserQueueRows = (
  client: Pick<DrizzleClient, "insert">,
  rows: import("@/drizzle/schema").UserQueue[],
) => client.insert(userQueue).values(rows);

/** Build the `userJutsu` selection for `settleJutsus`, using predicates on `userId` and `finishTraining`. */
export const selectUserJutsuForSettleJutsus = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({ finishTraining: userJutsu.finishTraining })
    .from(userJutsu)
    .where(and(eq(userJutsu.userId, userId), isNotNull(userJutsu.finishTraining)));

/** Build the `userItem` selection for `settleCrafts`, using predicates on `userId` and `craftingFinishedAt`. */
export const selectUserItemForSettleCrafts = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({ craftingFinishedAt: userItem.craftingFinishedAt })
    .from(userItem)
    .where(and(eq(userItem.userId, userId), isNotNull(userItem.craftingFinishedAt)));

/** Build the `userQueue` update for `rescheduleWaiting`, setting `startsAt` and `finishesAt`, using predicates on `id`. */
export const updateUserQueueForRescheduleWaiting = (
  client: Pick<DrizzleClient, "update">,
  scheduleCase: (column: "startsAt" | "finishesAt") => SQL<unknown>,
  moved: {
    startsAt: Date;
    finishesAt: Date;
    entry: { id: string; startsAt: Date; finishesAt: Date; durationSeconds: number };
  }[],
) =>
  client
    .update(userQueue)
    .set({ startsAt: scheduleCase("startsAt"), finishesAt: scheduleCase("finishesAt") })
    .where(
      inArray(
        userQueue.id,
        moved.map(({ entry }) => entry.id),
      ),
    );

/** Build the `userJutsu` update for `startQueuedJutsu`, using predicates on `id` and `level`. */
export const updateUserJutsuForStartQueuedJutsu = (
  client: Pick<DrizzleClient, "update">,
  startsAt: Date,
  finishesAt: Date,
  owned: { id: string; level: number },
) =>
  client
    .update(userJutsu)
    .set({
      level: sql`${userJutsu.level} + 1`,
      trainingStartedAt: startsAt,
      finishTraining: finishesAt,
    })
    .where(and(eq(userJutsu.id, owned.id), eq(userJutsu.level, owned.level)));

/** Build the `userJutsu` insert for `startQueuedJutsu`. */
export const insertUserJutsuForStartQueuedJutsu = (
  client: Pick<DrizzleClient, "insert">,
  entry: { userId: string; jutsuId: string },
  startsAt: Date,
  finishesAt: Date,
) =>
  client.insert(userJutsu).values({
    id: nanoid(),
    userId: entry.userId,
    jutsuId: entry.jutsuId,
    trainingStartedAt: startsAt,
    finishTraining: finishesAt,
  });

/** Build the `userCookingJob` insert for `startQueuedCraft`. */
export const insertUserCookingJobForStartQueuedCraft = (
  client: Pick<DrizzleClient, "insert">,
  entry: { userId: string; item: { cookingExperience: number }; quantity: number },
  territoryBoost: number,
  finishesAt: Date,
) =>
  client.insert(userCookingJob).values({
    id: nanoid(),
    userId: entry.userId,
    experience: getCookingExperience(
      entry.item.cookingExperience,
      entry.quantity,
      territoryBoost,
    ),
    finishesAt,
  });

/** Build the `userQueue` deletion for `claimQueueRow`, using predicates on `id`. */
export const deleteUserQueueForClaimQueueRow = (
  client: Pick<DrizzleClient, "delete">,
  id: string,
) => client.delete(userQueue).where(eq(userQueue.id, id));

/**
 * Build the `userData` update for `updateQueueOwner`, setting `questData` and
 * `updatedAt`, using predicates on `userId` and `updatedAt`.
 */
export const updateUserDataForUpdateQueueOwner = (
  client: Pick<DrizzleClient, "update">,
  amounts: {
    craftingExperience?: undefined | SQL<unknown>;
    money?: undefined | SQL<unknown>;
  },
  questData: import("@/validators/objectives").QuestTrackerType[],
  nextSnapshot: SQL<unknown>,
  user: { userId: string; updatedAt: Date },
) =>
  client
    .update(userData)
    .set({ ...amounts, questData, updatedAt: nextSnapshot })
    .where(
      and(eq(userData.userId, user.userId), eq(userData.updatedAt, user.updatedAt)),
    );

/** Build the `userData` update for `updateQueueOwner`, setting `updatedAt`, using predicates on `userId`. */
export const updateUserDataForUpdateQueueOwner2 = (
  client: Pick<DrizzleClient, "update">,
  amounts: {
    craftingExperience?: undefined | SQL<unknown>;
    money?: undefined | SQL<unknown>;
  },
  nextSnapshot: SQL<unknown>,
  owner: { userId: string },
) =>
  client
    .update(userData)
    .set({ ...amounts, updatedAt: nextSnapshot })
    .where(eq(userData.userId, owner.userId));

/** Build the `userItem` update for `merge`, setting `quantity`, including predicates on `id`, `userId`, `itemId`. */
export const updateUserItemForMerge = (
  client: Pick<DrizzleClient, "update">,
  material: {
    quantity: number;
    userItemId: string;
    itemId: string;
    storedAtHome: false | true;
  },
  userId: string,
  stackSize: SQL<unknown>,
) =>
  client
    .update(userItem)
    .set({ quantity: sql`${userItem.quantity} + ${material.quantity}` })
    .where(
      and(
        eq(userItem.id, material.userItemId),
        eq(userItem.userId, userId),
        eq(userItem.itemId, material.itemId),
        // Not mid-merge, not in an auction, not moved between home and carried.
        gt(userItem.quantity, 0),
        eq(userItem.isInAuction, false),
        eq(userItem.storedAtHome, material.storedAtHome),
        sql`${userItem.quantity} + ${material.quantity} <= COALESCE(${stackSize}, ${userItem.quantity} + ${material.quantity})`,
      ),
    );

/** Build the `userItem` insert for `returnMaterials`. */
export const insertUserItemForReturnMaterials = (
  client: Pick<DrizzleClient, "insert">,
  unmerged: import("@/validators/train").CraftingQueueMaterial[],
  userId: string,
) =>
  client.insert(userItem).values(
    unmerged.map((material) => ({
      id: nanoid(),
      userId,
      itemId: material.itemId,
      quantity: material.quantity,
      storedAtHome: material.storedAtHome,
    })),
  );

/** Build the `userData` lookup for `fetchQuestUser`, using predicates on `userId` and `jutsuId`. */
export const findUserDataForFetchQuestUser = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
  startsAt: undefined | Date,
  jutsuId: undefined | string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    extras: (table) => ({
      territoryWarBoostWindows: territoryWarBoostWindowsSql(table, startsAt).as(
        "territoryWarBoostWindows",
      ),
    }),
    with: {
      // The owned copy of the jutsu a queued level trains, in the same read.
      jutsus: { where: eq(userJutsu.jutsuId, jutsuId ?? "") },
      userQuests: userQuestHistoryRelation,
      completedQuests: completedQuestHistoryRelation,
      village: true,
      clan: true,
      items: {
        with: { item: { columns: { id: true, itemType: true, maxDurability: true } } },
      },
    },
  });

/** Build the `userData` update for `settleWaitingJobs`, setting `updatedAt`, using predicates on `userId`. */
export const updateUserDataForSettleWaitingJobs = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
) =>
  client
    .update(userData)
    .set({
      updatedAt: nextSnapshotSql(userData.updatedAt),
    })
    .where(eq(userData.userId, userId));

/** Build the `userJutsu` selection for `settleWaitingJobs`, using predicates on `userId` and `finishTraining`. */
export const selectUserJutsuForSettleWaitingJobs = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({ finish: userJutsu.finishTraining })
    .from(userJutsu)
    .where(and(eq(userJutsu.userId, userId), isNotNull(userJutsu.finishTraining)));

/** Build the `userItem` selection for `settleWaitingJobs`, using predicates on `userId` and `craftingFinishedAt`. */
export const selectUserItemForSettleWaitingJobs = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({ finish: userItem.craftingFinishedAt })
    .from(userItem)
    .where(and(eq(userItem.userId, userId), isNotNull(userItem.craftingFinishedAt)));

/** Build a timed stat or mastery training log insert using the supplied completion time. */
export const insertTrainingLog = (
  client: Pick<DrizzleClient, "insert">,
  userId: string,
  amount: number,
  stat: CombatStatName | TimedMasteryName,
  speed: TrainingSpeed,
  trainingFinishedAt: Date,
) =>
  client.insert(trainingLog).values({
    userId: userId,
    amount,
    stat: stat,
    speed: speed,
    trainingFinishedAt,
  });

/** Build the `userData` update for `updateTrainingSpeed`, setting `trainingSpeed`, using predicates on `userId`. */
export const updateUserDataForUpdateTrainingSpeed = (
  client: Pick<DrizzleClient, "update">,
  input: { speed: TrainingSpeed },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({ trainingSpeed: input.speed })
    .where(eq(userData.userId, ctx.userId));

/** Build the `trainingLog` listing for `getTrainingLog`, using predicates on `userId` and `trainingFinishedAt`. */
export const listTrainingLogForGetTrainingLog = (
  client: Pick<DrizzleClient, "query">,
  input: { userId: string },
) =>
  client.query.trainingLog.findMany({
    where: and(
      eq(trainingLog.userId, input.userId),
      gt(trainingLog.trainingFinishedAt, sql`NOW() - INTERVAL 1 DAY`),
    ),
  });

/** Restrict a queue statement to one user and queue kind. */
const queueOf = (userId: string, kind: QueueKind) =>
  and(eq(userQueue.userId, userId), eq(userQueue.kind, kind));
