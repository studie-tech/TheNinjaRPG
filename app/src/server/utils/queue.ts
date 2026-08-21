import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  item,
  trainingLog,
  userCraftingQueue,
  userData,
  userItem,
  userJutsu,
  userJutsuTrainingQueue,
  userStatTrainingQueue,
} from "@/drizzle/schema";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { splitQueue } from "@/libs/queue";
import { fetchUpdatedUser } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { getQueueTotalCapacity, getQueueWaitingSlots } from "@/utils/paypal";

type QueueTable =
  | typeof userStatTrainingQueue
  | typeof userJutsuTrainingQueue
  | typeof userCraftingQueue;

export type QueueResponse<T> = {
  waitingSlots: number;
  totalCapacity: number;
  active: T | null;
  waiting: T[];
};

const unfinishedWhere = <T extends QueueTable>(table: T, userId: string) =>
  and(eq(table.userId, userId), isNull(table.completedAt), isNull(table.cancelledAt));

export const getStatTrainingQueue = async (
  client: DrizzleClient,
  userId: string,
  now = new Date(),
) => {
  await settleStatTrainingQueue(client, userId, now);
  const [user, entries] = await Promise.all([
    client.query.userData.findFirst({ where: eq(userData.userId, userId) }),
    client.query.userStatTrainingQueue.findMany({
      where: unfinishedWhere(userStatTrainingQueue, userId),
      orderBy: asc(userStatTrainingQueue.startsAt),
    }),
  ]);
  if (!user) throw new Error("User not found");
  return { ...queueEntitlement(user), ...splitQueue(entries, now) };
};

export const getJutsuTrainingQueue = async (
  client: DrizzleClient,
  userId: string,
  now = new Date(),
) => {
  await settleJutsuTrainingQueue(client, userId, now);
  const [user, entries] = await Promise.all([
    client.query.userData.findFirst({ where: eq(userData.userId, userId) }),
    client.query.userJutsuTrainingQueue.findMany({
      where: unfinishedWhere(userJutsuTrainingQueue, userId),
      orderBy: asc(userJutsuTrainingQueue.startsAt),
      with: { jutsu: true },
    }),
  ]);
  if (!user) throw new Error("User not found");
  return { ...queueEntitlement(user), ...splitQueue(entries, now) };
};

export const getCraftingQueue = async (
  client: DrizzleClient,
  userId: string,
  now = new Date(),
) => {
  await settleCraftingQueue(client, userId, now);
  const [user, entries] = await Promise.all([
    client.query.userData.findFirst({ where: eq(userData.userId, userId) }),
    client.query.userCraftingQueue.findMany({
      where: unfinishedWhere(userCraftingQueue, userId),
      orderBy: asc(userCraftingQueue.startsAt),
      with: { item: true, materials: { with: { item: true } } },
    }),
  ]);
  if (!user) throw new Error("User not found");
  return { ...queueEntitlement(user), ...splitQueue(entries, now) };
};

export const getQueueOverview = async (
  client: DrizzleClient,
  userId: string,
  now = new Date(),
) => {
  await settleAllQueuesForUser(client, userId, now);
  const [stats, jutsus, crafting] = await Promise.all([
    client.query.userStatTrainingQueue.findMany({
      where: unfinishedWhere(userStatTrainingQueue, userId),
      orderBy: asc(userStatTrainingQueue.startsAt),
    }),
    client.query.userJutsuTrainingQueue.findMany({
      where: unfinishedWhere(userJutsuTrainingQueue, userId),
      orderBy: asc(userJutsuTrainingQueue.startsAt),
    }),
    client.query.userCraftingQueue.findMany({
      where: unfinishedWhere(userCraftingQueue, userId),
      orderBy: asc(userCraftingQueue.startsAt),
    }),
  ]);
  return {
    stats: splitQueue(stats, now),
    jutsus: splitQueue(jutsus, now),
    crafting: splitQueue(crafting, now),
  };
};

const queueEntitlement = (
  user: Pick<typeof userData.$inferSelect, "staffAccount" | "federalStatus">,
) => ({
  waitingSlots: getQueueWaitingSlots(user),
  totalCapacity: getQueueTotalCapacity(user),
});

/** Claiming completedAt happens inside the reward transaction. A rollback clears
 * the claim; a racing worker gets rowsAffected=0 and cannot duplicate effects. */
export const settleStatTrainingQueue = async (
  client: DrizzleClient,
  userId: string,
  now = new Date(),
) => {
  const due = await client.query.userStatTrainingQueue.findMany({
    where: and(
      unfinishedWhere(userStatTrainingQueue, userId),
      lte(userStatTrainingQueue.finishesAt, now),
    ),
    orderBy: asc(userStatTrainingQueue.finishesAt),
  });
  let completed = 0;
  for (const entry of due) {
    // Fetch outside the transaction — Vitess rejects Promise.all on a shared tx.
    const { user } = await fetchUpdatedUser({
      client,
      userId,
      skipQueueSettlement: true,
    });
    if (!user)
      throw new Error(`Could not settle stat queue for missing user ${userId}`);
    const { trackers } = getNewTrackers(user, [
      { task: "stats_trained", increment: entry.fullStatGain },
      { task: "minutes_training", increment: entry.durationSeconds / 60 },
    ]);
    const didComplete = await client.transaction(async (tx) => {
      await tx
        .update(userData)
        .set({ updatedAt: sql`${userData.updatedAt}` })
        .where(eq(userData.userId, userId));
      const claim = await tx
        .update(userStatTrainingQueue)
        .set({ completedAt: now })
        .where(
          and(
            eq(userStatTrainingQueue.id, entry.id),
            isNull(userStatTrainingQueue.completedAt),
            isNull(userStatTrainingQueue.cancelledAt),
          ),
        );
      if (claim.rowsAffected !== 1) return false;

      const statColumn = userData[entry.stat];
      await tx
        .update(userData)
        .set({
          [entry.stat]: sql`${statColumn} + ${entry.fullStatGain}`,
          experience: sql`${userData.experience} + ${entry.fullExperienceGain}`,
          dailyTrainings: sql`${userData.dailyTrainings} + 1`,
          questData: filterQuestTrackersForDbPersist(trackers, user),
        })
        .where(eq(userData.userId, userId));
      await tx.insert(trainingLog).values({
        userId,
        amount: entry.fullStatGain,
        stat: entry.stat,
        speed: entry.trainingSpeed,
        trainingFinishedAt: entry.finishesAt,
      });
      return true;
    });
    if (didComplete) completed += 1;
  }
  return completed;
};

export const settleJutsuTrainingQueue = async (
  client: DrizzleClient,
  userId: string,
  now = new Date(),
) => {
  const due = await client.query.userJutsuTrainingQueue.findMany({
    where: and(
      unfinishedWhere(userJutsuTrainingQueue, userId),
      lte(userJutsuTrainingQueue.finishesAt, now),
    ),
    orderBy: asc(userJutsuTrainingQueue.finishesAt),
  });
  let completed = 0;
  for (const entry of due) {
    const didComplete = await client.transaction(async (tx) => {
      await tx
        .update(userData)
        .set({ updatedAt: sql`${userData.updatedAt}` })
        .where(eq(userData.userId, userId));
      const claim = await tx
        .update(userJutsuTrainingQueue)
        .set({ completedAt: now })
        .where(
          and(
            eq(userJutsuTrainingQueue.id, entry.id),
            isNull(userJutsuTrainingQueue.completedAt),
            isNull(userJutsuTrainingQueue.cancelledAt),
          ),
        );
      if (claim.rowsAffected !== 1) return false as const;

      const existing = await tx.query.userJutsu.findFirst({
        where: and(eq(userJutsu.userId, userId), eq(userJutsu.jutsuId, entry.jutsuId)),
      });
      if (existing) {
        await tx
          .update(userJutsu)
          .set({ level: sql`${userJutsu.level} + 1`, updatedAt: now })
          .where(eq(userJutsu.id, existing.id));
        return "leveled" as const;
      }
      await tx.insert(userJutsu).values({
        id: nanoid(),
        userId,
        jutsuId: entry.jutsuId,
        level: 1,
        equipped: false,
      });
      return "mastered" as const;
    });
    if (didComplete === "mastered") {
      // Quest trackers outside tx — Vitess rejects fetchUpdatedUser's Promise.all on tx.
      const { user } = await fetchUpdatedUser({
        client,
        userId,
        skipQueueSettlement: true,
      });
      if (!user)
        throw new Error(`Could not settle jutsu queue for missing user ${userId}`);
      const { trackers } = getNewTrackers(user, [
        { task: "jutsus_mastered", increment: 1 },
        { task: "train_specific_jutsu", increment: 1, contentId: entry.jutsuId },
      ]);
      await client
        .update(userData)
        .set({ questData: filterQuestTrackersForDbPersist(trackers, user) })
        .where(eq(userData.userId, userId));
    }
    if (didComplete) completed += 1;
  }
  return completed;
};

export const settleCraftingQueue = async (
  client: DrizzleClient,
  userId: string,
  now = new Date(),
) => {
  const due = await client.query.userCraftingQueue.findMany({
    where: and(
      unfinishedWhere(userCraftingQueue, userId),
      lte(userCraftingQueue.finishesAt, now),
    ),
    orderBy: asc(userCraftingQueue.finishesAt),
  });
  let completed = 0;
  for (const entry of due) {
    // Fetch outside the transaction — Vitess rejects Promise.all on a shared tx.
    const { user } = await fetchUpdatedUser({
      client,
      userId,
      skipQueueSettlement: true,
    });
    if (!user)
      throw new Error(`Could not settle crafting queue for missing user ${userId}`);
    const { trackers } = getNewTrackers(user, [
      { task: "crafting_experience_gained", increment: entry.craftingExperience },
      { task: "items_crafted", increment: entry.quantity },
      {
        task: "craft_specific_item",
        increment: entry.quantity,
        contentId: entry.itemId,
      },
    ]);
    const didComplete = await client.transaction(async (tx) => {
      await tx
        .update(userData)
        .set({ updatedAt: sql`${userData.updatedAt}` })
        .where(eq(userData.userId, userId));
      const claim = await tx
        .update(userCraftingQueue)
        .set({ completedAt: now })
        .where(
          and(
            eq(userCraftingQueue.id, entry.id),
            isNull(userCraftingQueue.completedAt),
            isNull(userCraftingQueue.cancelledAt),
          ),
        );
      if (claim.rowsAffected !== 1) return false;

      // Legacy crafting created its output and awarded EXP/quests at enqueue.
      // Backfilled rows only need their linked future-dated inventory unlocked.
      if (entry.outputCreatedAt) {
        await tx
          .update(userItem)
          .set({ craftingFinishedAt: null })
          .where(
            and(
              eq(userItem.userId, userId),
              eq(userItem.itemId, entry.itemId),
              eq(userItem.craftingFinishedAt, entry.finishesAt),
            ),
          );
        return true;
      }

      const craftedItem = await tx.query.item.findFirst({
        where: eq(item.id, entry.itemId),
      });
      if (!craftedItem)
        throw new Error(`Crafting output item ${entry.itemId} is missing`);
      const outputs: (typeof userItem.$inferInsert)[] = [];
      let remaining = entry.quantity;
      while (remaining > 0) {
        const quantity = Math.min(remaining, craftedItem.stackSize);
        outputs.push({ id: nanoid(), userId, itemId: entry.itemId, quantity });
        remaining -= quantity;
      }
      if (outputs.length > 0) await tx.insert(userItem).values(outputs);

      await tx
        .update(userData)
        .set({
          craftingExperience: sql`${userData.craftingExperience} + ${entry.craftingExperience}`,
          questData: filterQuestTrackersForDbPersist(trackers, user),
        })
        .where(eq(userData.userId, userId));
      await tx
        .update(userCraftingQueue)
        .set({ outputCreatedAt: now })
        .where(eq(userCraftingQueue.id, entry.id));
      return true;
    });
    if (didComplete) completed += 1;
  }
  return completed;
};

export const settleAllQueuesForUser = async (
  client: DrizzleClient,
  userId: string,
  now = new Date(),
) => {
  // Queue types are independent; within each queue settlement stays chronological.
  const [stats, jutsus, crafting] = await Promise.all([
    settleStatTrainingQueue(client, userId, now),
    settleJutsuTrainingQueue(client, userId, now),
    settleCraftingQueue(client, userId, now),
  ]);
  return stats + jutsus + crafting;
};
