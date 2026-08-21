import * as Sentry from "@sentry/nextjs";
import { and, asc, isNull, lte } from "drizzle-orm";
import { cookies } from "next/headers";
import {
  userCraftingQueue,
  userJutsuTrainingQueue,
  userStatTrainingQueue,
} from "@/drizzle/schema";
import { drizzleDB } from "@/server/db";
import { settleAllQueuesForUser } from "@/server/utils/queue";

const BATCH_SIZE = 100;

export const GET = async (request: Request) => {
  await cookies();
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const [stats, jutsus, crafting] = await Promise.all([
    drizzleDB.query.userStatTrainingQueue.findMany({
      columns: { userId: true },
      where: and(
        isNull(userStatTrainingQueue.completedAt),
        isNull(userStatTrainingQueue.cancelledAt),
        lte(userStatTrainingQueue.finishesAt, now),
      ),
      orderBy: asc(userStatTrainingQueue.finishesAt),
      limit: BATCH_SIZE,
    }),
    drizzleDB.query.userJutsuTrainingQueue.findMany({
      columns: { userId: true },
      where: and(
        isNull(userJutsuTrainingQueue.completedAt),
        isNull(userJutsuTrainingQueue.cancelledAt),
        lte(userJutsuTrainingQueue.finishesAt, now),
      ),
      orderBy: asc(userJutsuTrainingQueue.finishesAt),
      limit: BATCH_SIZE,
    }),
    drizzleDB.query.userCraftingQueue.findMany({
      columns: { userId: true },
      where: and(
        isNull(userCraftingQueue.completedAt),
        isNull(userCraftingQueue.cancelledAt),
        lte(userCraftingQueue.finishesAt, now),
      ),
      orderBy: asc(userCraftingQueue.finishesAt),
      limit: BATCH_SIZE,
    }),
  ]);
  const userIds = [
    ...new Set([...stats, ...jutsus, ...crafting].map((entry) => entry.userId)),
  ];
  let completed = 0;
  const failures: string[] = [];
  for (const userId of userIds) {
    try {
      completed += await settleAllQueuesForUser(drizzleDB, userId, now);
    } catch (error) {
      failures.push(userId);
      Sentry.captureException(error, {
        tags: { job: "queue-maintenance" },
        extra: { userId },
      });
    }
  }
  return Response.json({ success: failures.length === 0, completed, failures });
};
