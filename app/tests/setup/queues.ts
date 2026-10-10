/** Queue fixtures for suites that run against the throwaway database. */
import { and, eq } from "drizzle-orm";
import { userData, userQueue } from "@/drizzle/schema";
import { getEnergyQueue, getMasteryQueue } from "@/libs/queue";
import type {
  EnergyTrainingQueueEntry,
  MasteryTrainingQueueEntry,
} from "@/validators/train";
import { getTestDatabase } from "./testDatabase";

/** Store `entries` as the user's live Energy queue, as the edit endpoint would. */
export const queueEnergy = async (
  userId: string,
  entries: readonly EnergyTrainingQueueEntry[],
) => {
  const database = await getTestDatabase();
  const [user] = await database
    .select({ head: userData.energyQueueHead })
    .from(userData)
    .where(eq(userData.userId, userId));
  const head = user?.head ?? 0;
  await database
    .delete(userQueue)
    .where(and(eq(userQueue.userId, userId), eq(userQueue.kind, "ENERGY")));
  if (entries.length) {
    await database.insert(userQueue).values(
      entries.map((entry, index) => ({
        id: `energy-${userId}-${head + index + 1}`,
        userId,
        kind: "ENERGY" as const,
        position: head + index + 1,
        stat: entry.stat,
        energy: entry.energy,
      })),
    );
  }
  await database
    .update(userData)
    .set({ energyQueueTail: head + entries.length })
    .where(eq(userData.userId, userId));
};

/** Store `entries` as the user's live mastery queue. */
export const queueMasteries = async (
  userId: string,
  entries: readonly MasteryTrainingQueueEntry[],
) => {
  const database = await getTestDatabase();
  const [user] = await database
    .select({ head: userData.masteryQueueHead })
    .from(userData)
    .where(eq(userData.userId, userId));
  const head = user?.head ?? 0;
  await database
    .delete(userQueue)
    .where(and(eq(userQueue.userId, userId), eq(userQueue.kind, "MASTERY")));
  if (entries.length) {
    await database.insert(userQueue).values(
      entries.map((entry, index) => ({
        id: `mastery-${userId}-${head + index + 1}`,
        userId,
        kind: "MASTERY" as const,
        position: head + index + 1,
        stat: entry.stat,
        speed: entry.speed,
      })),
    );
  }
};

const readUserQueue = async (userId: string) => {
  const database = await getTestDatabase();
  const [user] = await database.select().from(userData).where(eq(userData.userId, userId));
  if (!user) throw new Error(`user ${userId} missing`);
  const queue = await database
    .select()
    .from(userQueue)
    .where(eq(userQueue.userId, userId))
    .orderBy(userQueue.position);
  return { ...user, queue };
};

/** The user's live Energy queue, as the client derives it. */
export const readEnergyQueue = async (userId: string) =>
  getEnergyQueue(await readUserQueue(userId));

/** The user's live mastery queue, as the client derives it. */
export const readMasteryQueue = async (userId: string) =>
  getMasteryQueue(await readUserQueue(userId));
