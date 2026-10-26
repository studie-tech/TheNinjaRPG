import { beforeEach, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { forumPost, forumThread, notification, userData, userDataJob } from "@/drizzle/schema";
import { insertNewsThread } from "@/routers/forum";
import type { DrizzleClient } from "@/server/db";
import { deliveredNotificationFilter, enqueueUserDataJob, processUserDataJobs } from "@/server/utils/userDataJobs";
import { insertUsers } from "../../setup/factories";
import { beforeStatements, failStatements } from "../../setup/statements";
import { describeWithDatabase, getTestDatabase, recordQueries, resetTables } from "../../setup/testDatabase";

const old = new Date("2020-01-01T00:00:00Z");
const seedPlayers = (count: number) => insertUsers(Array.from({ length: count }, (_, i) => ({
  userId: `player-${String(i).padStart(4, "0")}`, createdAt: old, updatedAt: old,
  villagePrestige: 0, dailyMissions: 3, unreadNotifications: 7, unreadNews: 999,
  pvpExperience: 100, pvpExperienceDecayAt: old, tavernMessages: 101,
})));

describeWithDatabase("bounded durable UserData jobs", () => {
  beforeEach(() => resetTables(userDataJob, notification, forumPost, forumThread, userData));

  it("finishes a targeted daily reset before older broadcasts and preserves subsequent activity", async () => {
    const db = await getTestDatabase();
    await seedPlayers(2);
    await enqueueUserDataJob(db, { id: "a-broadcast", kind: "NEWS" });
    await enqueueUserDataJob(db, { id: "daily", kind: "DAILY_COUNTERS" });
    expect(await processUserDataJobs(db, { jobKind: "DAILY_COUNTERS", budgetMs: 250_000 })).toBe(true);
    const jobs = await db.query.userDataJob.findMany({ orderBy: userDataJob.id });
    expect(jobs[0]?.completedAt).toBeNull();
    expect(jobs[1]?.completedAt).toBeInstanceOf(Date);
    await db.update(userData).set({ dailyMissions: sql`${userData.dailyMissions} + 1`, aiCalls: sql`${userData.aiCalls} + 1` });
    await processUserDataJobs(db);
    expect((await db.query.userData.findMany()).every(user => user.dailyMissions === 1 && user.aiCalls === 1)).toBe(true);
  });

  it("prioritizes daily resets in chronological order before reporting completion", async () => {
    const db = await getTestDatabase();
    await seedPlayers(2);
    await db.insert(userDataJob).values([
      { id: "broadcast", kind: "NEWS", createdAt: new Date("2021-01-01") },
      { id: "older-reset", kind: "DAILY_COUNTERS", createdAt: new Date("2021-01-02") },
      { id: "current-reset", kind: "DAILY_COUNTERS", createdAt: new Date("2021-01-03") },
    ]);
    const recorded = await recordQueries(() => processUserDataJobs(db, { jobKind: "DAILY_COUNTERS" }));
    const updates = recorded.statements.filter(query => /^\s*UPDATE `UserDataJob` LEFT JOIN/.test(query));
    expect(updates).toHaveLength(2);
    expect(updates[0]).toContain("older-reset");
    expect(updates[1]).toContain("current-reset");
    expect((await db.query.userDataJob.findFirst({ where: eq(userDataJob.id, "broadcast") }))?.completedAt).toBeNull();
    expect((await db.query.userData.findMany()).every(user => user.villagePrestige === 2)).toBe(true);
  });

  it.each([{ table: forumPost, name: "body" }, { table: userDataJob, name: "delivery job" }])("rolls back news publication when its $name insert fails", async ({ table }) => {
    const db = await getTestDatabase();
    await seedPlayers(2);
    const failing = new Proxy(db, {
      get(target, key, receiver) {
        if (key === "transaction") return (run: (tx: DrizzleClient) => Promise<unknown>) => target.transaction(tx => run(failStatements(tx as unknown as DrizzleClient, table)));
        return Reflect.get(target, key, receiver);
      },
    });
    const thread = { id: "news-thread", title: "News", boardId: "board", userId: "player-0000" };
    const post = { id: "news-body", threadId: thread.id, content: "Announcement", userId: thread.userId, authorId: thread.userId };
    await expect(insertNewsThread(failing, thread, post, thread.userId)).rejects.toThrow("Statement failed on purpose");
    expect(await db.query.forumThread.findMany()).toHaveLength(0);
    expect(await db.query.forumPost.findMany()).toHaveLength(0);
    expect(await db.query.userDataJob.findMany()).toHaveLength(0);
    await insertNewsThread(db, thread, post, thread.userId);
    expect(await db.query.forumPost.findMany()).toHaveLength(1);
    expect(await db.query.userDataJob.findMany()).toHaveLength(1);
  });

  it("commits at most 500 IDs at a time and resumes a partial prestige grant once", async () => {
    const db = await getTestDatabase();
    await seedPlayers(1205);
    await enqueueUserDataJob(db, { id: "daily", kind: "DAILY_COUNTERS" });
    const interrupted = beforeStatements(db, userData, [async () => {}, async () => { throw new Error("interrupted"); }]);
    await expect(processUserDataJobs(interrupted)).rejects.toThrow("interrupted");
    const partial = await db.query.userData.findMany({ columns: { villagePrestige: true } });
    expect(partial.filter(user => user.villagePrestige === 1)).toHaveLength(500);
    const result = await recordQueries(() => processUserDataJobs(db));
    const updates = result.statements.filter(query => /^\s*UPDATE `UserDataJob` LEFT JOIN/.test(query));
    expect(updates).toHaveLength(2);
    for (const update of updates) expect((update.match(/'player-\d+'/g) ?? []).length).toBeLessThanOrEqual(502);
    await enqueueUserDataJob(db, { id: "daily", kind: "DAILY_COUNTERS" });
    await processUserDataJobs(db);
    const users = await db.query.userData.findMany({ columns: { villagePrestige: true, dailyMissions: true, updatedAt: true } });
    expect(users.every(user => user.villagePrestige === 1 && user.dailyMissions === 0 && user.updatedAt.getTime() === old.getTime())).toBe(true);
    expect((await db.query.userDataJob.findFirst())?.completedAt).toBeInstanceOf(Date);
  });

  it("competing workers and a lost commit acknowledgment cannot duplicate increments", async () => {
    const db = await getTestDatabase();
    await seedPlayers(1005);
    await enqueueUserDataJob(db, { id: "notice", kind: "NOTIFICATION" });
    let fail = true;
    const lostResponse = new Proxy(db, {
      get(target, key, receiver) {
        if (key === "execute") return async (query: Parameters<DrizzleClient["execute"]>[0]) => {
          const result = await target.execute(query);
          if (fail) { fail = false; throw new Error("response lost after commit"); }
          return result;
        };
        return Reflect.get(target, key, receiver);
      },
    });
    await expect(processUserDataJobs(lostResponse)).rejects.toThrow("response lost");
    await Promise.all([processUserDataJobs(db), processUserDataJobs(db)]);
    expect((await db.query.userData.findMany()).every(user => user.unreadNotifications === 8)).toBe(true);
  });

  it("keeps news caps and author exclusion, and excludes AIs from staff notices", async () => {
    const db = await getTestDatabase();
    await seedPlayers(3);
    await db.update(userData).set({ isAi: true }).where(eq(userData.userId, "player-0002"));
    await insertUsers([{ userId: "late", username: "late-player", createdAt: new Date(Date.now() + 60_000), unreadNews: 0 }]);
    await enqueueUserDataJob(db, { id: "news", kind: "NEWS", excludedUserId: "player-0000" });
    await enqueueUserDataJob(db, { id: "news-2", kind: "NEWS", excludedUserId: "player-0000" });
    await enqueueUserDataJob(db, { id: "staff", kind: "NOTIFICATION" });
    await processUserDataJobs(db);
    const users = await db.query.userData.findMany({ orderBy: userData.userId });
    expect(users.map(user => user.unreadNews)).toEqual([0, 999, 1000, 1000]);
    expect(users.map(user => user.unreadNotifications)).toEqual([0, 8, 8, 7]);
  });

  it("advances safely when every selected recipient reads before the batch write", async () => {
    const db = await getTestDatabase();
    await seedPlayers(4);
    await enqueueUserDataJob(db, { id: "news", kind: "NEWS" });
    const reading = beforeStatements(db, userData, [() => db.update(userData).set({ unreadNews: 0, newsReadAt: new Date(Date.now() + 1000) })]);
    await processUserDataJobs(reading);
    expect((await db.query.userData.findMany()).every(user => user.unreadNews === 0)).toBe(true);
    expect((await db.query.userDataJob.findFirst())?.completedAt).toBeInstanceOf(Date);
  });

  it("keeps pending announcements out of the toast feed until their counters are delivered", async () => {
    const db = await getTestDatabase();
    await seedPlayers(1);
    await db.insert(notification).values({ userId: "player-0000", content: "Delivered" });
    const inserted = await db.insert(notification).values({ userId: "player-0000", content: "Pending" });
    await enqueueUserDataJob(db, { id: `notification:${inserted.insertId}`, kind: "NOTIFICATION" });
    const feed = () => db.query.notification.findMany({ where: deliveredNotificationFilter("player-0000") });
    expect((await feed()).map(row => row.content)).toEqual(["Delivered"]);
    await processUserDataJobs(db);
    expect((await feed()).map(row => row.content)).toEqual(["Delivered", "Pending"]);
  });

  it("decays tavern activity once per job without marking activity", async () => {
    const db = await getTestDatabase();
    await seedPlayers(3);
    await db.update(userData).set({ isAi: true }).where(eq(userData.userId, "player-0002"));
    await enqueueUserDataJob(db, { id: "tavern", kind: "TAVERN_DECAY" });
    await processUserDataJobs(db);
    const users = await db.query.userData.findMany({ orderBy: userData.userId });
    expect(users.every(user => user.tavernMessages === 95 && user.updatedAt.getTime() === old.getTime())).toBe(true);
    await db.update(userData).set({ tavernMessages: sql`${userData.tavernMessages} + 1` });
    await processUserDataJobs(db);
    expect((await db.query.userData.findMany()).every(user => user.tavernMessages === 96)).toBe(true);
  });
});
