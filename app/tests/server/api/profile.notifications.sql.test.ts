import { beforeEach, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { TERRITORY_WAR_TARGET_POINTS } from "@/drizzle/constants";
import { notification, territoryWar, territoryWarScore, userData, userDataJob, village } from "@/drizzle/schema";
import { profileRouter } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { resolveTerritoryWar } from "@/server/utils/territoryWar";
import { enqueueUserDataJob, processUserDataJobs, readUserNotifications } from "@/server/utils/userDataJobs";
import { insertUsers } from "../../setup/factories";
import { beforeStatements } from "../../setup/statements";
import { callerFor, describeWithDatabase, getTestDatabase, recordQueries, resetTables } from "../../setup/testDatabase";

const old = new Date("2020-01-01");

describeWithDatabase("profile deferred notification consumption", () => {
  beforeEach(async () => {
    await resetTables(notification, userDataJob, territoryWarScore, territoryWar, userData, village);
    const db = await getTestDatabase();
    await db.insert(village).values({ id: "home", name: "Home", kageId: "reader", sector: 1 });
    await insertUsers([{ userId: "reader", username: "Reader", createdAt: old, villageId: "home", questData: [], status: "AWAKE" }]);
  });

  it.each([false, true])("keeps immediate notices separate from a pending territory victory at timeout=%s", async timeout => {
    const db = await getTestDatabase();
    await publish(db, "immediate", false, new Date("2021-01-01"));
    const now = new Date();
    await db.insert(territoryWar).values({ id: "victory", predecessorId: "initial", sector: 100, guardianId: "guardian", startsAt: new Date(now.getTime() - 10_000), endsAt: new Date(now.getTime() + (timeout ? -1000 : 60_000)) });
    await db.insert(territoryWarScore).values({ warId: "victory", competitorId: "village:home", name: "Home", villageId: "home", points: timeout ? 1 : TERRITORY_WAR_TARGET_POINTS });
    await db.transaction(tx => resolveTerritoryWar(tx as unknown as DrizzleClient, "victory", now));
    const victory = await db.query.notification.findFirst({ where: eq(notification.userId, "guardian") });
    expect(victory?.isDeferred).toBe(true);
    expect((await db.query.userDataJob.findFirst())?.completedAt).toBeNull();
    expect(await toasts()).toEqual(["immediate"]);
    await processUserDataJobs(db);
    expect((await snapshot(db)).unreadNotificationIds).toEqual([victory!.id]);
    expect(await toasts()).toEqual([victory!.content]);
    expect(await toasts()).toEqual([]);
  });

  it("returns an older deferred broadcast after a newer immediate notice was consumed", async () => {
    const db = await getTestDatabase();
    const deferredId = await publish(db, "deferred", true, new Date("2021-01-01"));
    await publish(db, "immediate", false, new Date("2022-01-01"));
    expect(await toasts()).toEqual(["immediate"]);
    await processUserDataJobs(db);
    const delivered = await snapshot(db);
    expect(delivered.unreadNotifications).toBe(1);
    expect(delivered.unreadNotificationIds).toEqual([deferredId]);
    expect(await toasts()).toEqual(["deferred"]);
    expect(await toasts()).toEqual([]);
    expect((await snapshot(db)).unreadNotificationIds).toEqual([]);
  });

  it("consumes several deferred broadcasts and immediate notices by identity in publication order", async () => {
    const db = await getTestDatabase();
    await publish(db, "deferred-old", true, new Date("2021-01-01"));
    await publish(db, "immediate", false, new Date("2022-01-01"));
    await publish(db, "deferred-new", true, new Date("2023-01-01"));
    await processUserDataJobs(db);
    const user = await snapshot(db);
    expect(user.unreadNotifications).toBe(3);
    const recorded = await recordQueries(() => readUserNotifications(db, user));
    expect(recorded.result.map(row => row.content)).toEqual(["deferred-new", "immediate", "deferred-old"]);
    expect(recorded.statements).toHaveLength(3);
    expect(await toasts()).toEqual([]);
  });

  it("retains identity and excludes consumed broadcasts after completed jobs expire", async () => {
    const db = await getTestDatabase();
    await publish(db, "deferred", true, new Date("2023-01-01"));
    await processUserDataJobs(db);
    await db.delete(userDataJob);
    expect(await toasts()).toEqual(["deferred"]);
    await publish(db, "immediate", false, new Date("2022-01-01"));
    expect(await toasts()).toEqual(["immediate"]);
    expect(await toasts()).toEqual([]);
  });

  it("does not leak pending or ineligible broadcasts into the immediate feed after job cleanup", async () => {
    const db = await getTestDatabase();
    await insertUsers([
      { userId: "ai", username: "AI", isAi: true, createdAt: old },
      { userId: "late", username: "Late", createdAt: new Date(Date.now() + 60_000) },
    ]);
    await publish(db, "deferred", true, new Date("2023-01-01"));
    await publish(db, "immediate", false, new Date("2022-01-01"));
    expect(await toasts()).toEqual(["immediate"]);
    await processUserDataJobs(db);
    await db.delete(userDataJob);
    for (const userId of ["ai", "late"]) {
      const user = await snapshot(db, userId);
      expect(user.unreadNotifications).toBe(0);
      expect(user.unreadNotificationIds).toEqual([]);
    }
    await db.update(userData).set({ unreadNotifications: 1 }).where(eq(userData.userId, "late"));
    expect((await readUserNotifications(db, await snapshot(db, "late"))).map(row => row.content)).toEqual(["immediate"]);
    expect(await toasts()).toEqual(["deferred"]);
  });

  it("retries when a deferred delivery arrives between fetching the feed and claiming it", async () => {
    const db = await getTestDatabase();
    await publish(db, "first", true, new Date("2021-01-01"));
    await processUserDataJobs(db);
    const first = await snapshot(db);
    await publish(db, "second", true, new Date("2022-01-01"));
    const interleaved = beforeStatements(db, userData, [() => processUserDataJobs(db)]);
    const recorded = await recordQueries(() => readUserNotifications(interleaved, first));
    expect(recorded.result.map(row => row.content)).toEqual(["second", "first"]);
    expect(recorded.statements.filter(query => /^update `UserData` set/.test(query))).toHaveLength(2);
    expect(await toasts()).toEqual([]);
    expect((await snapshot(db)).unreadNotifications).toBe(0);
  });

  it("retries when an immediate delivery arrives during a deferred acknowledgement", async () => {
    const db = await getTestDatabase();
    await publish(db, "deferred", true, new Date("2021-01-01"));
    await processUserDataJobs(db);
    const first = await snapshot(db);
    const interleaved = beforeStatements(db, userData, [() => publish(db, "immediate", false, new Date("2022-01-01"))]);
    expect((await readUserNotifications(interleaved, first)).map(row => row.content)).toEqual(["immediate", "deferred"]);
    expect(await toasts()).toEqual([]);
  });

  it("claims repeated and concurrent profile snapshots once without swallowing later deliveries", async () => {
    const db = await getTestDatabase();
    await publish(db, "first", true, new Date("2021-01-01"));
    await processUserDataJobs(db);
    const first = await snapshot(db);
    const results = await Promise.all([toasts(), toasts()]);
    expect(results.flat()).toEqual(["first"]);
    expect(await readUserNotifications(db, first)).toEqual([]);
    await publish(db, "second", true, new Date("2022-01-01"));
    await processUserDataJobs(db);
    expect((await readUserNotifications(db, first)).map(row => row.content)).toEqual(["second"]);
    expect(await toasts()).toEqual([]);
  });

  it("rechecks eligibility at the batch write and advances without retaining skipped receipts", async () => {
    const db = await getTestDatabase();
    await publish(db, "deferred", true);
    const interleaved = beforeStatements(db, userData, [() => db.update(userData).set({ isAi: true })]);
    await processUserDataJobs(interleaved);
    expect((await snapshot(db)).unreadNotificationIds).toEqual([]);
    expect((await snapshot(db)).unreadNotifications).toBe(0);
    expect((await db.query.userDataJob.findFirst())?.completedAt).toBeInstanceOf(Date);
  });
});

const publish = async (db: DrizzleClient, content: string, isDeferred: boolean, createdAt?: Date) => {
  const inserted = await db.insert(notification).values({ userId: "reader", content, isDeferred, createdAt });
  if (isDeferred) await enqueueUserDataJob(db, { id: `notification:${inserted.insertId}`, kind: "NOTIFICATION" });
  else await db.update(userData).set({ unreadNotifications: sql`${userData.unreadNotifications} + 1` }).where(eq(userData.userId, "reader"));
  return Number(inserted.insertId);
};

const snapshot = async (db: DrizzleClient, userId = "reader") => {
  const user = await db.query.userData.findFirst({ where: eq(userData.userId, userId) });
  if (!user) throw new Error("Missing notification reader");
  return user;
};

const toasts = async () => (await (await callerFor(profileRouter, "reader")).getUser()).notifications.filter(row => row.color === "toast").map(row => row.name);
