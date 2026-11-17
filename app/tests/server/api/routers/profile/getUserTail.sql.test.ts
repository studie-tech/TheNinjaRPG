/** Pin the profile read's notification waves and the farm counts it reports. */
import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  dungeonMember,
  dungeonRun,
  farmPlot,
  notification,
  userData,
  userVote,
  village,
} from "@/drizzle/schema";
import { getWorldCyclePosition } from "@/libs/dayNight";
import { profileRouter } from "@/server/api/routers/profile";
import { dungeonBattleState, dungeonContent } from "../../../../setup/dungeon";
import { insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../../setup/testDatabase";
import { readUser } from "../../../../setup/userReads";

const STAFF_ID = "profile-tail-staff";
const PLAYER_ID = "profile-tail-player";
const HOUR_MS = 3600000;

describeWithDatabase("profile read notification waves", () => {
  beforeEach(async () => {
    await resetTables(
      userData,
      userVote,
      village,
      dungeonRun,
      dungeonMember,
      notification,
      farmPlot,
    );
    await insertUsers(
      [STAFF_ID, PLAYER_ID].map((userId) => ({
        userId,
        username: userId,
        role: userId === STAFF_ID ? ("CODING-ADMIN" as const) : ("USER" as const),
        status: "AWAKE" as const,
        level: 50,
        rank: "JONIN" as const,
        villageId: "home",
        sector: 1,
        regenAt: new Date(),
        updatedAt: new Date(),
      })),
    );
    const db = await getTestDatabase();
    await db
      .insert(village)
      .values({ id: "home", name: "Home", kageId: "other", sector: 1 });
    await db.insert(notification).values(
      ["Older news", "Latest news"].map((content, index) => ({
        userId: STAFF_ID,
        content,
        createdAt: new Date(Date.now() - (2 - index) * HOUR_MS),
      })),
    );
    // Settle first-read bookkeeping (vote rows) so later reads measure the steady state.
    await Promise.all(
      [STAFF_ID, PLAYER_ID].map(async (id) =>
        (await callerFor(profileRouter, id)).getUser(),
      ),
    );
  });

  it("claims a dungeon queue and reads announcements in the staff count wave", async () => {
    const quiet = await readProfile(STAFF_ID);
    await seedLobby(STAFF_ID);
    await setUnread(STAFF_ID, 2);
    const busy = await readProfile(STAFF_ID);

    // Only the guarded announcement claim follows the shared wave.
    expect(busy.roundTrips - quiet.roundTrips).toBe(1);
    expect(busy.result.userData?.status).toBe("QUEUED");
    const names = busy.result.notifications.map((link) => link.name);
    expect(names[0]).toBe("Active Dungeon Squad");
    expect(names.slice(-2)).toEqual(["Latest news", "Older news"]);
    expect(await readUser(STAFF_ID)).toMatchObject({
      status: "QUEUED",
      unreadNotifications: 0,
    });
  });

  it("delivers announcements once, after the feed is read", async () => {
    const quiet = await readProfile(PLAYER_ID);
    await setUnread(PLAYER_ID, 1);
    const first = await readProfile(PLAYER_ID);
    const second = await readProfile(PLAYER_ID);

    expect(first.roundTrips - quiet.roundTrips).toBe(2);
    expect(first.result.notifications).toContainEqual(
      expect.objectContaining({ name: "Latest news", href: "/news", color: "toast" }),
    );
    expect(second.roundTrips).toBe(quiet.roundTrips);
    expect(second.result.notifications.map((link) => link.name)).not.toContain(
      "Latest news",
    );
  });

  it("counts ready and unwatered plots in one statement", async () => {
    const db = await getTestDatabase();
    const now = Date.now();
    const cycleStart = getWorldCyclePosition(new Date(now)).cycleStart;
    const plot = (
      slotIndex: number,
      values: Partial<typeof farmPlot.$inferInsert>,
      userId = PLAYER_ID,
    ) => ({ id: `plot-${userId}-${slotIndex}`, userId, slotIndex, ...values });
    await db.insert(farmPlot).values([
      // Ready to harvest, watered or not.
      plot(0, { seedItemId: "seed", finishAt: new Date(now - HOUR_MS) }),
      plot(1, {
        seedItemId: "seed",
        finishAt: new Date(now - 1000),
        lastWateredAt: new Date(now),
      }),
      // Growing and never watered, or last watered before the current cycle.
      plot(2, { seedItemId: "seed", finishAt: new Date(now + HOUR_MS) }),
      plot(3, {
        seedItemId: "seed",
        finishAt: new Date(now + HOUR_MS),
        lastWateredAt: new Date(cycleStart - 60000),
      }),
      plot(4, {
        seedItemId: "seed",
        finishAt: new Date(now + HOUR_MS),
        lastWateredAt: new Date(cycleStart - 60000),
      }),
      // Growing and watered this cycle, empty, or someone else's.
      plot(5, {
        seedItemId: "seed",
        finishAt: new Date(now + HOUR_MS),
        lastWateredAt: new Date(Math.max(cycleStart, now - 1000)),
      }),
      plot(6, { finishAt: new Date(now - HOUR_MS) }),
      plot(0, { seedItemId: "seed", finishAt: new Date(now - HOUR_MS) }, STAFF_ID),
    ]);

    const { result, statements } = await readProfile(PLAYER_ID);

    expect(result.notifications).toContainEqual(
      expect.objectContaining({ name: "2 farm crops are ready to harvest" }),
    );
    expect(result.notifications).toContainEqual(
      expect.objectContaining({ name: "3 farm plants are ready to water" }),
    );
    expect(
      statements.filter((statement) => /from `FarmPlot`/i.test(statement)),
    ).toHaveLength(1);
  });
});

/** Read the profile through the router, recording its statements and sequential waves. */
const readProfile = async (userId: string) => {
  const caller = await callerFor(profileRouter, userId);
  return recordQueries(() => caller.getUser());
};

/** Reserve an open lobby slot for `userId`. */
const seedLobby = async (userId: string) => {
  const db = await getTestDatabase();
  await db.insert(dungeonRun).values({
    id: "lobby",
    dungeonId: "definition",
    leaderId: userId,
    content: dungeonContent(),
    state: { ...dungeonBattleState().runState, memberIds: [userId] },
    status: "LOBBY",
    version: 0,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + HOUR_MS),
  });
  await db
    .insert(dungeonMember)
    .values({ runId: "lobby", userId, activeUserId: userId });
};

/** Mark `count` global announcements unread for `userId`. */
const setUnread = async (userId: string, count: number) =>
  (await getTestDatabase())
    .update(userData)
    .set({ unreadNotifications: count })
    .where(eq(userData.userId, userId));
