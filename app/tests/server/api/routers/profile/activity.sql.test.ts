import { afterEach, beforeEach, expect, it, setSystemTime } from "bun:test";
import { eq } from "drizzle-orm";
import { userData, userVote } from "@/drizzle/schema";
import { updateUserActivity } from "@/queries/profile";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { insertUsers, insertUserVotes } from "../../../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../../setup/testDatabase";
import { requireUser } from "../../../../setup/userReads";

const NOW = new Date("2026-11-21T12:00:00Z");
const OLD_ACTIVITY = new Date("2026-11-01T12:00:00Z");
const USER_ID = "session-activity";
const USER_IP = "127.0.0.1";

describeWithDatabase("profile session activity", () => {
  beforeEach(async () => {
    setSystemTime(NOW);
    await resetTables(userData, userVote);
    await insertUsers([
      {
        userId: USER_ID,
        updatedAt: NOW,
        regenAt: NOW,
        lastActiveAt: OLD_ACTIVITY,
        lastIp: USER_IP,
        primaryElement: "Fire",
      },
    ]);
    await insertUserVotes([{ userId: USER_ID }]);
  });
  afterEach(() => setSystemTime());

  it.each([null, OLD_ACTIVITY])(
    "records a visit despite a recently changed gameplay snapshot (%s)",
    async (lastActiveAt) => {
      const db = await getTestDatabase();
      await db
        .update(userData)
        .set({ lastActiveAt })
        .where(eq(userData.userId, USER_ID));
      await fetchUpdatedUser({ client: db, userId: USER_ID, userIp: USER_IP });
      expect((await requireUser(USER_ID)).lastActiveAt).toEqual(NOW);
    },
  );

  it("leaves background loads untouched and throttles repeated visits", async () => {
    const db = await getTestDatabase();
    await fetchUpdatedUser({ client: db, userId: USER_ID });
    expect((await requireUser(USER_ID)).lastActiveAt).toEqual(OLD_ACTIVITY);
    await db
      .update(userData)
      .set({ lastActiveAt: NOW })
      .where(eq(userData.userId, USER_ID));
    const { statements } = await recordQueries(() =>
      fetchUpdatedUser({ client: db, userId: USER_ID, userIp: USER_IP }),
    );
    expect(
      statements.filter((statement) => statement.includes("`lastActiveAt` =")),
    ).toHaveLength(0);
  });

  it.each(["BATTLE", "TRAVEL", "HOSPITALIZED", "QUEUED"] as const)(
    "records a %s visit without settling passive pools",
    async (status) => {
      const db = await getTestDatabase();
      await db
        .update(userData)
        .set({ status, battleId: "active-battle" })
        .where(eq(userData.userId, USER_ID));
      await fetchUpdatedUser({ client: db, userId: USER_ID, userIp: USER_IP });
      expect(await requireUser(USER_ID)).toMatchObject({
        lastActiveAt: NOW,
        updatedAt: NOW,
        regenAt: NOW,
        status,
      });
    },
  );

  it("preserves activity from a concurrent newer visit", async () => {
    const db = await getTestDatabase();
    await updateUserActivity(db, USER_ID, NOW, new Date(NOW.getTime() - 300_000));
    const result = await updateUserActivity(db, USER_ID, OLD_ACTIVITY, OLD_ACTIVITY);
    expect(result.rowsAffected).toBe(0);
    expect((await requireUser(USER_ID)).lastActiveAt).toEqual(NOW);
  });
});
