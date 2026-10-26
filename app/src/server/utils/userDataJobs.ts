import type { SQL } from "drizzle-orm";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import { notification, userData, userDataJob } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";

const USER_DATA_BATCH_SIZE = 500;
type UserDataJob = typeof userDataJob.$inferSelect;

/** A deterministic source/day ID prevents repeated schedulers from creating duplicate work. */
export const enqueueUserDataJob = (
  client: DrizzleClient,
  job: Pick<UserDataJob, "id" | "kind"> & Partial<Pick<UserDataJob, "excludedUserId">>,
) =>
  client
    .insert(userDataJob)
    .values(job)
    .onDuplicateKeyUpdate({ set: { id: sql`${userDataJob.id}` } });

/**
 * Drain the oldest work first, yielding between committed primary-key batches. The budget
 * bounds background invocations; the minute cron resumes any remaining durable cursor.
 * A reset-only drain bypasses broadcasts while retaining day order; false means the budget expired.
 * Call only with an autocommit client: an enclosing transaction would retain every lock.
 */
export const processUserDataJobs = async (
  client: DrizzleClient,
  {
    budgetMs = 20_000,
    jobKind,
  }: { budgetMs?: number; jobKind?: UserDataJob["kind"] } = {},
) => {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const job = await client.query.userDataJob.findFirst({
      where: and(
        isNull(userDataJob.completedAt),
        jobKind ? eq(userDataJob.kind, jobKind) : undefined,
      ),
      orderBy: [asc(userDataJob.createdAt), asc(userDataJob.id)],
    });
    if (!job) return true;
    const recipients = recipientFilter(job);
    const users = await client
      .select({ userId: userData.userId })
      .from(userData)
      .where(
        and(
          gt(userData.userId, job.cursor),
          lte(userData.createdAt, job.createdAt),
          recipients,
        ),
      )
      .orderBy(asc(userData.userId))
      .limit(USER_DATA_BATCH_SIZE);
    const guard = and(
      eq(userDataJob.id, job.id),
      eq(userDataJob.cursor, job.cursor),
      isNull(userDataJob.completedAt),
    );
    if (!users.length) {
      await retryOnDeadlock(() =>
        client.update(userDataJob).set({ completedAt: new Date() }).where(guard),
      );
      continue;
    }
    const cursor = users[users.length - 1]!.userId;
    const columns = getTableColumns(userData);
    const assignments = Object.entries(jobChanges(job)).map(
      ([key, value]) => sql`${columns[key as keyof typeof columns]} = ${value}`,
    );
    // As in war settlement receipts, one guarded multi-table UPDATE commits both the
    // SQL increments and their cursor. A LEFT JOIN advances even if all selected users
    // were deleted or became ineligible. Competing workers cannot deliver a batch twice.
    await retryOnDeadlock(() =>
      client.execute(sql`
      UPDATE ${userDataJob} LEFT JOIN ${userData} FORCE INDEX (PRIMARY)
        ON ${and(
          inArray(
            userData.userId,
            users.map((user) => user.userId),
          ),
          recipients,
        )}
      SET ${sql.join(assignments, sql`, `)}, ${userDataJob.cursor} = ${cursor}
      WHERE ${guard}
    `),
    );
  }
  return false;
};

const recipientFilter = (job: UserDataJob) =>
  and(
    job.kind === "NOTIFICATION" ? eq(userData.isAi, false) : undefined,
    job.excludedUserId ? ne(userData.userId, job.excludedUserId) : undefined,
    job.kind === "NEWS"
      ? sql`NOT JSON_CONTAINS(${userData.newsReadIds}, JSON_QUOTE(${job.id}))`
      : undefined,
  );

const jobChanges = (
  job: UserDataJob,
): Partial<Record<keyof typeof userData.$inferSelect, number | Date | SQL>> => {
  switch (job.kind) {
    case "NEWS":
      return {
        unreadNews: sql`LEAST(${userData.unreadNews} + 1, 1000)`,
        newsVersion: sql`${userData.newsVersion} + 1`,
      };
    case "NOTIFICATION":
      return {
        unreadNotifications: sql`${userData.unreadNotifications} + 1`,
        unreadNotificationIds: sql`JSON_ARRAY_APPEND(${userData.unreadNotificationIds}, '$', ${Number(job.id.slice("notification:".length))})`,
      };
    case "TAVERN_DECAY":
      return { tavernMessages: sql`FLOOR(${userData.tavernMessages} * 0.95)` };
    case "DAILY_COUNTERS":
      return {
        villagePrestige: sql`${userData.villagePrestige} + 1`,
        dailyArenaFights: 0,
        dailyMissions: 0,
        dailyErrands: 0,
        dailyMedicalMissions: 0,
        dailyPvpMissions: 0,
        dailyWarMissions: 0,
        dailyTrainings: 0,
        dailyOverworldQuestRolls: 0,
        dailySageActivations: 0,
        aiCalls: 0,
      };
  }
};

/** Claim exact deferred deliveries alongside the existing immediate counter-based feed. */
export const readUserNotifications = async (
  client: DrizzleClient,
  snapshot: Pick<
    typeof userData.$inferSelect,
    "userId" | "unreadNotifications" | "unreadNotificationIds"
  >,
) => {
  let current = snapshot;
  while (current.unreadNotifications > 0) {
    const immediateCount = Math.max(
      current.unreadNotifications - current.unreadNotificationIds.length,
      0,
    );
    const [deferred, immediate] = await Promise.all([
      current.unreadNotificationIds.length
        ? client.query.notification.findMany({
            where: inArray(notification.id, current.unreadNotificationIds),
          })
        : [],
      immediateCount
        ? client.query.notification.findMany({
            where: eq(notification.isDeferred, false),
            orderBy: desc(notification.createdAt),
            limit: immediateCount,
          })
        : [],
    ]);
    // Both delivery and acknowledgement change the same user row. Claim only the
    // queried snapshot so a competing reader cannot repeat it or clear a new delivery.
    const claimed = await retryOnDeadlock(() =>
      client
        .update(userData)
        .set({
          unreadNotifications: 0,
          unreadNotificationIds: [],
        })
        .where(
          and(
            eq(userData.userId, current.userId),
            eq(userData.unreadNotifications, current.unreadNotifications),
            sql`${userData.unreadNotificationIds} = CAST(${JSON.stringify(current.unreadNotificationIds)} AS JSON)`,
          ),
        ),
    );
    if (claimed.rowsAffected > 0)
      return [...deferred, ...immediate].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id,
      );
    const latest = await client.query.userData.findFirst({
      where: eq(userData.userId, current.userId),
      columns: { userId: true, unreadNotifications: true, unreadNotificationIds: true },
    });
    if (!latest) return [];
    current = latest;
  }
  return [];
};
