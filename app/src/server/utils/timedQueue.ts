import { and, asc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { JUTSU_LEVEL_CAP } from "@/drizzle/constants";
import {
  item,
  questHistory,
  userCraftingQueue,
  userData,
  userItem,
  userJutsu,
  userJutsuTrainingQueue,
} from "@/drizzle/schema";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { getQueuedJobStart, latestDate, rescheduleQueue } from "@/libs/queue";
import {
  calcJutsuTrainCost,
  calcJutsuTrainTime,
  checkJutsuBloodline,
  checkJutsuVillage,
} from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import { fetchStudents } from "@/routers/sensei";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { getQueueTotalCapacity } from "@/utils/paypal";
import type { CraftingQueueMaterial } from "@/validators/train";

/**
 * Timed queues hold jobs waiting behind the active jutsu training or craft. A waiting
 * job has already paid (ryo, materials); when its turn comes it is started exactly as a
 * direct start would be, backdated to the moment its predecessor finished, and its
 * queue row is deleted in the same transaction. Settlement runs on the queue endpoints
 * and from the queue-maintenance cron, so jobs advance while the player is offline.
 */

type Tx = Parameters<Parameters<DrizzleClient["transaction"]>[0]>[0];
type JobOutcome = { finishesAt: Date } | "dropped" | "conflict";

/** Raised inside a transaction to roll it back when a guarded write lost a race. */
const conflict = Symbol("timedQueueConflict");

/** Waiting jutsu levels, oldest first. */
export const fetchJutsuTrainingQueue = (client: DrizzleClient, userId: string) =>
  client.query.userJutsuTrainingQueue.findMany({
    where: eq(userJutsuTrainingQueue.userId, userId),
    orderBy: [
      asc(userJutsuTrainingQueue.startsAt),
      asc(userJutsuTrainingQueue.createdAt),
    ],
    with: { jutsu: true },
  });

/** Waiting crafts, oldest first. */
export const fetchCraftingQueue = (client: DrizzleClient, userId: string) =>
  client.query.userCraftingQueue.findMany({
    where: eq(userCraftingQueue.userId, userId),
    orderBy: [asc(userCraftingQueue.startsAt), asc(userCraftingQueue.createdAt)],
    with: { item: true },
  });

/** Jutsu ids with levels waiting in the user's queue. */
export const fetchQueuedJutsuIds = async (client: DrizzleClient, userId: string) => {
  const rows = await client
    .select({ jutsuId: userJutsuTrainingQueue.jutsuId })
    .from(userJutsuTrainingQueue)
    .where(eq(userJutsuTrainingQueue.userId, userId));
  return new Set(rows.map((row) => row.jutsuId));
};

/** Whether another job may be added behind the active one. */
export const hasQueueRoom = (
  user: Parameters<typeof getQueueTotalCapacity>[0],
  waiting: number,
) => 1 + waiting < getQueueTotalCapacity(user);

/** Start every waiting jutsu level whose turn has come. Returns how many started. */
export const settleJutsuTrainingQueue = async (
  client: DrizzleClient,
  userId: string,
  now = new Date(),
) => {
  const waiting = await fetchJutsuTrainingQueue(client, userId);
  if (waiting.length === 0) return 0;
  const owned = await client
    .select({ finishTraining: userJutsu.finishTraining })
    .from(userJutsu)
    .where(and(eq(userJutsu.userId, userId), isNotNull(userJutsu.finishTraining)));
  let students: Awaited<ReturnType<typeof fetchStudents>> | undefined;
  return settleWaitingJobs({
    client,
    waiting,
    now,
    lastFinish: latestDate(owned.map((row) => row.finishTraining)),
    table: userJutsuTrainingQueue,
    start: async (entry, startsAt) => {
      students ??= await fetchStudents(client, userId);
      return startQueuedJutsu(client, entry, startsAt, students);
    },
  });
};

/** Start every waiting craft whose turn has come. Returns how many started. */
export const settleCraftingQueue = async (
  client: DrizzleClient,
  userId: string,
  now = new Date(),
) => {
  const waiting = await fetchCraftingQueue(client, userId);
  if (waiting.length === 0) return 0;
  const crafting = await client
    .select({ craftingFinishedAt: userItem.craftingFinishedAt })
    .from(userItem)
    .where(and(eq(userItem.userId, userId), isNotNull(userItem.craftingFinishedAt)));
  return settleWaitingJobs({
    client,
    waiting,
    now,
    lastFinish: latestDate(crafting.map((row) => row.craftingFinishedAt)),
    table: userCraftingQueue,
    start: (entry, startsAt) => startQueuedCraft(client, entry, startsAt),
  });
};

export const settleTimedQueuesForUser = async (
  client: DrizzleClient,
  userId: string,
  now = new Date(),
) => {
  // Sequential: both may write the same user's questData.
  const jutsus = await settleJutsuTrainingQueue(client, userId, now);
  const crafts = await settleCraftingQueue(client, userId, now);
  return jutsus + crafts;
};

/** Cancel a waiting jutsu level and refund its reserved ryo. */
export const cancelQueuedJutsuTraining = async (
  client: DrizzleClient,
  userId: string,
  queueId: string,
) => {
  const refunded = await retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      const [entry] = await tx
        .select()
        .from(userJutsuTrainingQueue)
        .where(
          and(
            eq(userJutsuTrainingQueue.id, queueId),
            eq(userJutsuTrainingQueue.userId, userId),
          ),
        );
      if (!entry) return null;
      if (!(await claimQueueRow(tx, userJutsuTrainingQueue, entry.id))) return null;
      await refundRyo(tx, userId, entry.reservedRyo);
      return entry.reservedRyo;
    }),
  );
  if (refunded !== null) await settleJutsuTrainingQueue(client, userId);
  return refunded;
};

/** Cancel a waiting craft and return its materials. */
export const cancelQueuedCraft = async (
  client: DrizzleClient,
  userId: string,
  queueId: string,
) => {
  const entry = await client.query.userCraftingQueue.findFirst({
    where: and(eq(userCraftingQueue.id, queueId), eq(userCraftingQueue.userId, userId)),
  });
  if (!entry) return false;
  const stackSizes = await fetchStackSizes(client, entry.materials);
  const cancelled = await retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      if (!(await claimQueueRow(tx, userCraftingQueue, entry.id))) return false;
      await returnMaterials(tx, userId, entry.materials, stackSizes);
      return true;
    }),
  );
  if (cancelled) await settleCraftingQueue(client, userId);
  return cancelled;
};

/**
 * Walk the waiting jobs in order: start each whose turn has come, then move the rest
 * so they follow the job that is now running.
 */
const settleWaitingJobs = async <
  T extends { id: string; startsAt: Date; finishesAt: Date; durationSeconds: number },
>(props: {
  client: DrizzleClient;
  waiting: T[];
  now: Date;
  lastFinish: Date | null;
  table: typeof userJutsuTrainingQueue | typeof userCraftingQueue;
  start: (entry: T, startsAt: Date) => Promise<JobOutcome>;
}) => {
  const { client, waiting, now, lastFinish, table, start } = props;
  let chainedFinish: Date | null = null;
  let started = 0;
  for (const [index, entry] of waiting.entries()) {
    const startsAt = getQueuedJobStart({
      scheduledStart: entry.startsAt,
      lastFinish,
      chainedFinish,
      now,
    });
    if (!startsAt) {
      const runningUntil = chainedFinish ?? lastFinish ?? now;
      await rescheduleWaiting(client, table, waiting.slice(index), runningUntil);
      break;
    }
    const outcome = await start(entry, startsAt);
    // A lost race leaves the rest for the next settlement, which re-reads the queue.
    if (outcome === "conflict") break;
    if (outcome === "dropped") {
      // The next job takes the dropped job's slot.
      chainedFinish = startsAt;
      continue;
    }
    chainedFinish = outcome.finishesAt;
    started += 1;
  }
  return started;
};

const rescheduleWaiting = async (
  client: DrizzleClient,
  table: typeof userJutsuTrainingQueue | typeof userCraftingQueue,
  entries: { id: string; startsAt: Date; finishesAt: Date; durationSeconds: number }[],
  startsAt: Date,
) => {
  const moved = rescheduleQueue(entries, startsAt).filter(
    ({ entry, startsAt: next }) => entry.startsAt.getTime() !== next.getTime(),
  );
  // Timestamps only order the queue, so a concurrent reschedule computing the same
  // chain from the same running job is harmless.
  await Promise.all(
    moved.map(({ entry, startsAt: next, finishesAt }) =>
      client
        .update(table)
        .set({ startsAt: next, finishesAt })
        .where(eq(table.id, entry.id)),
    ),
  );
};

/**
 * Start a queued jutsu level as `jutsu.startTraining` would, except the ryo was paid on
 * enqueue. Price and duration use the level reached by then; ryo above the current price
 * is refunded. A level that can no longer be trained is dropped with a full refund.
 */
const startQueuedJutsu = (
  client: DrizzleClient,
  entry: Awaited<ReturnType<typeof fetchJutsuTrainingQueue>>[number],
  startsAt: Date,
  students: Awaited<ReturnType<typeof fetchStudents>>,
) =>
  runJob(client, async (tx) => {
    await lockUser(tx, entry.userId);
    if (!(await claimQueueRow(tx, userJutsuTrainingQueue, entry.id))) return "conflict";
    // Sequential: PlanetScale rejects concurrent queries on one transaction.
    const owned = await tx.query.userJutsu.findFirst({
      where: and(
        eq(userJutsu.userId, entry.userId),
        eq(userJutsu.jutsuId, entry.jutsuId),
      ),
    });
    const user = await fetchQuestUser(tx, entry.userId);
    const info = entry.jutsu;
    const level = owned?.level ?? 0;
    const trainable =
      !!info &&
      !info.hidden &&
      level < JUTSU_LEVEL_CAP &&
      (!info.parentJutsuId || !!owned) &&
      checkJutsuBloodline(info, user) &&
      checkJutsuVillage(info, user);
    if (!info || !trainable) {
      await refundRyo(tx, entry.userId, entry.reservedRyo);
      return "dropped";
    }
    const cost = Math.min(
      entry.reservedRyo,
      calcJutsuTrainCost(info, level, user, students),
    );
    const finishesAt = new Date(
      startsAt.getTime() + calcJutsuTrainTime(info, level, user),
    );
    if (owned) {
      const updated = await tx
        .update(userJutsu)
        .set({ level: sql`${userJutsu.level} + 1`, finishTraining: finishesAt })
        .where(and(eq(userJutsu.id, owned.id), eq(userJutsu.level, owned.level)));
      if (updated.rowsAffected !== 1) throw conflict;
    } else {
      await tx.insert(userJutsu).values({
        id: nanoid(),
        userId: entry.userId,
        jutsuId: entry.jutsuId,
        finishTraining: finishesAt,
      });
      const { trackers } = getNewTrackers(user, [
        { task: "jutsus_mastered", increment: 1 },
        { task: "train_specific_jutsu", increment: 1, contentId: entry.jutsuId },
      ]);
      await tx
        .update(userData)
        .set({ questData: filterQuestTrackersForDbPersist(trackers, user) })
        .where(eq(userData.userId, entry.userId));
    }
    await refundRyo(tx, entry.userId, entry.reservedRyo - cost);
    return { finishesAt };
  });

/**
 * Start a queued craft as `occupation.craftItem` would: the output appears locked until
 * the craft finishes, and crafting experience and quest progress are granted now. The
 * materials were taken on enqueue; a craft that is no longer possible returns them.
 */
const startQueuedCraft = async (
  client: DrizzleClient,
  entry: Awaited<ReturnType<typeof fetchCraftingQueue>>[number],
  startsAt: Date,
) => {
  const craftable = !!entry.item && !entry.item.hidden && entry.item.canBeCrafted;
  const stackSizes = craftable ? null : await fetchStackSizes(client, entry.materials);
  return runJob(client, async (tx) => {
    await lockUser(tx, entry.userId);
    if (!(await claimQueueRow(tx, userCraftingQueue, entry.id))) return "conflict";
    if (!entry.item || !craftable) {
      await returnMaterials(tx, entry.userId, entry.materials, stackSizes ?? new Map());
      return "dropped";
    }
    const user = await fetchQuestUser(tx, entry.userId);
    const finishesAt = new Date(startsAt.getTime() + entry.durationSeconds * 1000);
    const outputs: (typeof userItem.$inferInsert)[] = [];
    const stackSize = Math.max(1, entry.item.stackSize);
    for (let remaining = entry.quantity; remaining > 0; remaining -= stackSize) {
      outputs.push({
        id: nanoid(),
        userId: entry.userId,
        itemId: entry.itemId,
        quantity: Math.min(remaining, stackSize),
        craftingFinishedAt: finishesAt,
      });
    }
    await tx.insert(userItem).values(outputs);
    // Clan boosts apply to the experience as they do for a direct craft.
    const clanBoost = user.isOutlaw ? 0 : (user.clan?.craftingExpBoost ?? 0) / 100;
    const expGain = Math.floor(
      (entry.item.craftingExperience ?? 0) * entry.quantity * (1 + clanBoost),
    );
    const { trackers } = getNewTrackers(user, [
      { task: "crafting_experience_gained", increment: expGain },
      { task: "items_crafted", increment: entry.quantity },
      {
        task: "craft_specific_item",
        increment: entry.quantity,
        contentId: entry.itemId,
      },
    ]);
    await tx
      .update(userData)
      .set({
        craftingExperience: sql`${userData.craftingExperience} + ${expGain}`,
        questData: filterQuestTrackersForDbPersist(trackers, user),
      })
      .where(eq(userData.userId, entry.userId));
    return { finishesAt };
  });
};

/** A job transaction; a lost guarded write rolls it back and reports a conflict. */
const runJob = async (
  client: DrizzleClient,
  job: (tx: Tx) => Promise<JobOutcome>,
): Promise<JobOutcome> => {
  try {
    return await retryOnDeadlock(() => client.transaction(job));
  } catch (error) {
    if (error === conflict) return "conflict";
    throw error;
  }
};

/** Serialize with other queue jobs of this user before reading quest state. */
const lockUser = (tx: Tx, userId: string) =>
  tx
    .update(userData)
    .set({ updatedAt: sql`${userData.updatedAt}` })
    .where(eq(userData.userId, userId));

/** Deleting the row is the claim: only one settlement or cancellation can win it. */
const claimQueueRow = async (
  tx: Tx,
  table: typeof userJutsuTrainingQueue | typeof userCraftingQueue,
  id: string,
) => {
  const result = await tx.delete(table).where(eq(table.id, id));
  return result.rowsAffected === 1;
};

const refundRyo = async (tx: Tx, userId: string, amount: number) => {
  if (amount <= 0) return;
  await tx
    .update(userData)
    .set({ money: sql`${userData.money} + ${amount}` })
    .where(eq(userData.userId, userId));
};

const fetchStackSizes = async (
  client: DrizzleClient,
  materials: CraftingQueueMaterial[],
) => {
  const ids = [...new Set(materials.map((material) => material.itemId))];
  if (ids.length === 0) return new Map<string, number>();
  const rows = await client
    .select({ id: item.id, stackSize: item.stackSize })
    .from(item)
    .where(inArray(item.id, ids));
  return new Map(rows.map((row) => [row.id, row.stackSize]));
};

/**
 * Put taken materials back on the stack they came from while it exists and has room,
 * otherwise as a new stack in the same place.
 */
const returnMaterials = async (
  tx: Tx,
  userId: string,
  materials: CraftingQueueMaterial[],
  stackSizes: Map<string, number>,
) => {
  for (const material of materials) {
    const stackSize = stackSizes.get(material.itemId);
    const merged = await tx
      .update(userItem)
      .set({ quantity: sql`${userItem.quantity} + ${material.quantity}` })
      .where(
        and(
          eq(userItem.id, material.userItemId),
          eq(userItem.userId, userId),
          eq(userItem.itemId, material.itemId),
          ...(stackSize
            ? [sql`${userItem.quantity} + ${material.quantity} <= ${stackSize}`]
            : []),
        ),
      );
    if (merged.rowsAffected === 1) continue;
    await tx.insert(userItem).values({
      id: nanoid(),
      userId,
      itemId: material.itemId,
      quantity: material.quantity,
      storedAtHome: material.storedAtHome,
    });
  }
};

/**
 * Quest context read after the user lock. Unlike a session refresh, settling a queue
 * must not regenerate pools, assign quests or mark the user online.
 */
const fetchQuestUser = async (tx: Tx, userId: string) => {
  const user = await tx.query.userData.findFirst({
    where: eq(userData.userId, userId),
    with: {
      userQuests: {
        where: or(
          and(isNull(questHistory.endAt), eq(questHistory.completed, 0)),
          eq(questHistory.questType, "achievement"),
        ),
        with: { quest: true },
      },
      completedQuests: {
        columns: { id: true, questId: true, completed: true },
        where: gte(questHistory.completed, 1),
      },
      village: true,
      clan: true,
      items: {
        with: { item: { columns: { id: true, itemType: true, maxDurability: true } } },
      },
    },
  });
  if (!user) throw new Error(`Could not settle queue for missing user ${userId}`);
  // Tracker evaluation reads quests, village and items, all loaded above.
  return user as unknown as NonNullable<UserWithRelations>;
};
