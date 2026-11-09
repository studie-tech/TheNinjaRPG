import { afterAll, beforeAll, beforeEach, expect, it } from "bun:test";
import { and, eq, isNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { UserRoles } from "@/drizzle/constants";
import * as schema from "@/drizzle/schema";
import { quest, questHistory, userData } from "@/drizzle/schema";
import { userQuestHistoryRelation } from "@/server/utils/achievementObjectives";
import { canPlayHiddenQuests } from "@/utils/permissions";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuestHistory, insertQuests, insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const createReadDatabase = (pool: mysql.Pool) =>
  drizzle(pool, { schema, mode: "planetscale" });

describeWithDatabase("user quest definition visibility", () => {
  let pool: mysql.Pool;
  let readDatabase: ReturnType<typeof createReadDatabase>;
  beforeAll(() => {
    pool = mysql.createPool({ uri: process.env.TEST_MYSQL_URL });
    readDatabase = createReadDatabase(pool);
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await resetTables(questHistory, quest, userData);
    await insertUsers(
      UserRoles.map((role) => ({ userId: role, username: role, role })),
    );
    await insertQuests([
      { id: "visible", questType: "story", hidden: false },
      { id: "hidden", questType: "story", hidden: true },
      { id: "hidden-achievement", questType: "achievement", hidden: true },
      { id: "achievement", questType: "achievement", hidden: false },
      { id: "isolated", questType: "story", hidden: true },
      { id: "pyramid", questType: "battlepyramid", hidden: true },
      { id: "expired", questType: "event", endsAt: "2000-01-01 00:00:00" },
    ]);
    await insertQuestHistory(
      UserRoles.flatMap((userId) => [
        { userId, questId: "visible", questType: "story" as const },
        { userId, questId: "hidden", questType: "story" as const },
        {
          userId,
          questId: "hidden-achievement",
          questType: "achievement" as const,
          completed: 1,
          endAt: new Date(),
        },
        {
          userId,
          questId: "achievement",
          questType: "achievement" as const,
          completed: 1,
          endAt: new Date(),
        },
        { userId, questId: "isolated", questType: "story" as const, isolated: true },
        { userId, questId: "pyramid", questType: "battlepyramid" as const },
        {
          userId,
          questId: "deleted-isolated",
          questType: "story" as const,
          isolated: true,
        },
        { userId, questId: "deleted-pyramid", questType: "battlepyramid" as const },
        { userId, questId: "deleted", questType: "story" as const },
        { userId, questId: "expired", questType: "event" as const },
      ]),
    );
  });

  it("keeps tracker cleanup, run recovery and completed achievement rows while applying each player's role", async () => {
    const client = readDatabase;
    const users = await client.query.userData.findMany({
      columns: { userId: true, role: true },
      with: { userQuests: userQuestHistoryRelation },
    });
    for (const user of users) {
      const expected = [
        "visible",
        "achievement",
        "isolated",
        "pyramid",
        "deleted-isolated",
        "deleted-pyramid",
        "deleted",
        "expired",
      ];
      if (canPlayHiddenQuests(user.role)) expected.push("hidden", "hidden-achievement");
      expect(user.userQuests.map((entry) => entry.questId).sort()).toEqual(
        expected.sort(),
      );
      expect(
        user.userQuests.find((entry) => entry.questId === "deleted-isolated")?.quest,
      ).toBeNull();
      expect(
        user.userQuests.find((entry) => entry.questId === "deleted-pyramid")?.quest,
      ).toBeNull();
      expect(
        user.userQuests.find((entry) => entry.questId === "deleted")?.quest,
      ).toBeNull();
    }
    const player = await client.query.userData.findFirst({
      columns: { userId: true },
      where: eq(userData.userId, "USER"),
      with: { userQuests: userQuestHistoryRelation },
    });
    expect(player?.userQuests.some((entry) => entry.questId === "hidden")).toBe(false);
  });

  it("avoids transferring a large hidden definition while retaining the same visible definitions", async () => {
    const client = await getTestDatabase();
    await client
      .update(quest)
      .set({
        content: {
          objectives: [],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "x".repeat(100_000),
          sceneCharacters: [],
        },
      })
      .where(eq(quest.id, "hidden"));
    const before = await readDatabase.query.userData.findFirst({
      columns: { userId: true },
      where: eq(userData.userId, "USER"),
      with: {
        userQuests: {
          where: or(
            and(isNull(questHistory.endAt), eq(questHistory.completed, 0)),
            eq(questHistory.questType, "achievement"),
          ),
          with: { quest: true },
        },
      },
    });
    const after = await readDatabase.query.userData.findFirst({
      columns: { userId: true },
      where: eq(userData.userId, "USER"),
      with: { userQuests: userQuestHistoryRelation },
    });
    expect(
      Buffer.byteLength(JSON.stringify(before)) -
        Buffer.byteLength(JSON.stringify(after)),
    ).toBeGreaterThan(100_000);
    const byQuestId = (a: { questId: string }, b: { questId: string }) =>
      a.questId.localeCompare(b.questId);
    expect(after?.userQuests.sort(byQuestId)).toEqual(
      before?.userQuests
        .filter(
          (entry) =>
            entry.isolated ||
            entry.questType === "battlepyramid" ||
            !entry.quest?.hidden,
        )
        .sort(byQuestId),
    );
  });
});
