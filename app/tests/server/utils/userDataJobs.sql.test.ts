import { beforeEach, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { forumBoard, forumPost, forumThread, notification, userData, userDataJob } from "@/drizzle/schema";
import { fetchForumPageData, readNews } from "@/libs/forum";
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
  beforeEach(() => resetTables(userDataJob, notification, forumPost, forumThread, forumBoard, userData));

  it.each([0, 3])("preserves an unseen news publication committing after a page read with %i unread", async (unreadNews) => {
    const db = await getTestDatabase();
    await seedNewsReader(db, unreadNews);
    const publication = holdNewsPublication(db, "uncommitted");
    try {
      await publication.inserted;
      const page = await fetchForumPageData(db, "News", "reader");
      expect(page.initialThreads.threads).toHaveLength(0);
      await readNews(db, "reader", page.initialThreads.newsReadIds);
    } finally {
      publication.release();
      await publication.publishing;
    }
    await processUserDataJobs(db);
    expect((await db.query.userData.findFirst())?.unreadNews).toBe(1);
    expect((await db.query.userDataJob.findFirst())?.completedAt).toBeInstanceOf(Date);
  });

  it.each([0, 3])("acknowledges committed articles before deferred delivery with %i unread", async (unreadNews) => {
    const db = await getTestDatabase();
    await seedNewsReader(db, unreadNews);
    await publishNews(db, "seen");
    const page = await fetchForumPageData(db, "News", "reader");
    expect(page.initialThreads.threads.map(({ id }) => id)).toEqual(["seen"]);
    expect(page.initialThreads.newsReadIds).toEqual(["news:seen"]);
    await readNews(db, "reader", page.initialThreads.newsReadIds);
    await processUserDataJobs(db);
    await readNews(db, "reader", page.initialThreads.newsReadIds);
    expect((await db.query.userData.findFirst())?.unreadNews).toBe(0);
  });

  it("keeps an earlier insertion unread when publications commit out of order", async () => {
    const db = await getTestDatabase();
    await seedNewsReader(db);
    const earlier = holdNewsPublication(db, "earlier", new Date("2021-01-01"));
    try {
      await earlier.inserted;
      await publishNews(db, "later", new Date("2022-01-01"));
      const page = await fetchForumPageData(db, "News", "reader");
      expect(page.initialThreads.threads.map(({ id }) => id)).toEqual(["later"]);
      expect(page.initialThreads.newsReadIds).toEqual(["news:later"]);
      await readNews(db, "reader", page.initialThreads.newsReadIds);
      await processUserDataJobs(db);
    } finally {
      earlier.release();
      await earlier.publishing;
    }
    await processUserDataJobs(db);
    const jobs = await db.query.userDataJob.findMany({ orderBy: userDataJob.createdAt });
    expect(jobs.map(({ id }) => id)).toEqual(["news:earlier", "news:later"]);
    expect(jobs[0]!.createdAt.getTime()).toBeLessThan(jobs[1]!.createdAt.getTime());
    expect((await db.query.userData.findFirst())?.unreadNews).toBe(1);
  });

  it("preserves unseen delivery between page loading and acknowledgement, including stale pages", async () => {
    const db = await getTestDatabase();
    await seedNewsReader(db, 3);
    await publishNews(db, "seen");
    const first = await fetchForumPageData(db, "News", "reader");
    await publishNews(db, "unseen");
    await processUserDataJobs(db);
    await readNews(db, "reader", first.initialThreads.newsReadIds);
    expect((await db.query.userData.findFirst())?.unreadNews).toBe(1);
    await readNews(db, "reader", first.initialThreads.newsReadIds);
    expect((await db.query.userData.findFirst())?.unreadNews).toBe(1);
    const second = await fetchForumPageData(db, "News", "reader");
    await readNews(db, "reader", second.initialThreads.newsReadIds);
    await Promise.all([
      readNews(db, "reader", second.initialThreads.newsReadIds),
      readNews(db, "reader", first.initialThreads.newsReadIds),
    ]);
    const user = await db.query.userData.findFirst();
    expect(user?.unreadNews).toBe(0);
    expect(user?.newsReadIds.sort()).toEqual(["news:seen", "news:unseen"]);
  });

  it.each([0, 1000])("retries acknowledgement when a delivery races its CAS with %i unread", async (unreadNews) => {
    const db = await getTestDatabase();
    await seedNewsReader(db, unreadNews);
    const page = await fetchForumPageData(db, "News", "reader");
    const interleaved = beforeStatements(db, userData, [async () => {
      await publishNews(db, "unseen");
      await processUserDataJobs(db);
    }]);
    const measured = await recordQueries(() => readNews(interleaved, "reader", page.initialThreads.newsReadIds));
    expect(measured.statements.filter(query => /^update `UserData` set/.test(query))).toHaveLength(2);
    expect((await db.query.userData.findFirst())?.unreadNews).toBe(1);
  });

  it("keeps the explicit read mutation's first snapshot on a delivery retry", async () => {
    const db = await getTestDatabase();
    await seedNewsReader(db);
    await publishNews(db, "seen");
    const interleaved = beforeStatements(db, userData, [async () => {
      await publishNews(db, "unseen");
      await processUserDataJobs(db);
    }]);
    await readNews(interleaved, "reader");
    const user = await db.query.userData.findFirst();
    expect(user?.unreadNews).toBe(1);
    expect(user?.newsReadIds).toEqual(["news:seen"]);
  });

  it("clears the board's committed news across pagination and prunes expired receipts", async () => {
    const db = await getTestDatabase();
    await seedNewsReader(db);
    for (let i = 0; i < 12; i++) await publishNews(db, `article-${i}`);
    const page = await fetchForumPageData(db, "News", "reader");
    expect(page.initialThreads.threads).toHaveLength(10);
    expect(page.initialThreads.newsReadIds).toHaveLength(12);
    await readNews(db, "reader", page.initialThreads.newsReadIds);
    await processUserDataJobs(db);
    expect((await db.query.userData.findFirst())?.unreadNews).toBe(0);
    await db.delete(userDataJob).where(eq(userDataJob.id, "news:article-0"));
    await readNews(db, "reader", page.initialThreads.newsReadIds);
    expect((await db.query.userData.findFirst())?.newsReadIds).toHaveLength(11);
  });

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
    const reading = beforeStatements(db, userData, [() => Promise.all(Array.from({ length: 4 }, (_, i) => readNews(db, `player-${String(i).padStart(4, "0")}`, ["news"])))]);
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

const seedNewsReader = async (db: DrizzleClient, unreadNews = 0) => {
  await insertUsers([{ userId: "reader", username: "reader", createdAt: old, unreadNews }]);
  await db.insert(forumBoard).values({ id: "news", name: "News", summary: "", group: "" });
};

const publishNews = (db: DrizzleClient, id: string, createdAt?: Date) => insertNewsThread(db,
  { id, title: id, boardId: "news", userId: "author", createdAt },
  { id: `body-${id}`, threadId: id, content: id, userId: "author", authorId: "author" }, "author");

const holdNewsPublication = (db: DrizzleClient, id: string, createdAt?: Date) => {
  let ready!: () => void;
  let release!: () => void;
  const inserted = new Promise<void>(resolve => { ready = resolve; });
  const commit = new Promise<void>(resolve => { release = resolve; });
  const gated = new Proxy(db, {
    get(target, key, receiver) {
      if (key === "transaction") return (run: (tx: DrizzleClient) => Promise<unknown>) => target.transaction(async tx => {
        const result = await run(tx as unknown as DrizzleClient);
        ready();
        await commit;
        return result;
      });
      return Reflect.get(target, key, receiver);
    },
  });
  return { inserted, release, publishing: publishNews(gated, id, createdAt) };
};
