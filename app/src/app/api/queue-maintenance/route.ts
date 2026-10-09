import * as Sentry from "@sentry/nextjs";
import { asc, lte } from "drizzle-orm";
import { cookies } from "next/headers";
import { userCraftingQueue, userJutsuTrainingQueue } from "@/drizzle/schema";
import { handleEndpointError, lockWithMinuteTimer } from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { settleTimedQueuesForUser } from "@/server/utils/timedQueue";

const ENDPOINT_NAME = "queue-maintenance";
const BATCH_SIZE = 100;

/** Start queued jutsu training and crafts whose turn came while their owner was away. */
export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  const minuteCheck = await lockWithMinuteTimer(drizzleDB, ENDPOINT_NAME);
  if (!minuteCheck.isNewMinute && minuteCheck.response) return minuteCheck.response;

  try {
    const now = new Date();
    // Settlement reschedules jobs still behind a running one, so they leave this window.
    const [jutsus, crafts] = await Promise.all([
      drizzleDB
        .selectDistinct({ userId: userJutsuTrainingQueue.userId })
        .from(userJutsuTrainingQueue)
        .where(lte(userJutsuTrainingQueue.startsAt, now))
        .orderBy(asc(userJutsuTrainingQueue.userId))
        .limit(BATCH_SIZE),
      drizzleDB
        .selectDistinct({ userId: userCraftingQueue.userId })
        .from(userCraftingQueue)
        .where(lte(userCraftingQueue.startsAt, now))
        .orderBy(asc(userCraftingQueue.userId))
        .limit(BATCH_SIZE),
    ]);
    const userIds = [...new Set([...jutsus, ...crafts].map((row) => row.userId))];
    let started = 0;
    const failures: string[] = [];
    for (const userId of userIds) {
      try {
        started += await settleTimedQueuesForUser(drizzleDB, userId, now);
      } catch (error) {
        failures.push(userId);
        Sentry.captureException(error, {
          tags: { job: ENDPOINT_NAME },
          extra: { userId },
        });
      }
    }
    return Response.json({ success: failures.length === 0, started, failures });
  } catch (cause) {
    return handleEndpointError(cause, { endpoint: ENDPOINT_NAME });
  }
}
