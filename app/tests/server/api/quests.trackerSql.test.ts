// @vitest-environment node

import { eq, inArray } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { questHistory, userData } from "@/drizzle/schema";
import { QuestTracker } from "@/validators/objectives";
import { upsertQuestEntries } from "../../../src/server/api/routers/quests";
import { insertUsers } from "../../setup/factories";
import { describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

/**
 * The bulk daily reset clears a tracker with raw JSON surgery (JSON_SEARCH + JSON_REMOVE). The
 * other quest suites assert the statement drizzle renders; these run it on a real MySQL, because
 * the rendered string says nothing about whether the engine drops the element you meant.
 */
/** Parsed through the validator so a stored tracker always matches the shape the app writes. */
const tracker = (id: string, done: boolean, goalId = "o1") =>
  QuestTracker.parse({
    id,
    startAt: "2026-01-01T00:00:00.000Z",
    goals: [{ id: goalId, done, value: 1 }],
  });

const trackersOf = async (userId: string) => {
  const database = await getTestDatabase();
  const [row] = await database
    .select({ questData: userData.questData })
    .from(userData)
    .where(eq(userData.userId, userId));
  return row?.questData ?? null;
};

const trackerIds = async (userId: string) =>
  ((await trackersOf(userId)) ?? []).map((entry) => entry.id);

describeWithDatabase("bulk daily reset against a real MySQL", () => {
  beforeEach(async () => {
    await resetTables(questHistory, userData);
  });

  const reset = async (questId: string, userIds: string[]) =>
    upsertQuestEntries(
      await getTestDatabase(),
      { id: questId, questType: "daily" } as never,
      inArray(userData.userId, userIds) as never,
    );

  it("drops only the reassigned quest's tracker, across every stored questData shape", async () => {
    await insertUsers([
      { userId: "mixed", questData: [tracker("q_a", true), tracker("q_b", true)] },
      // nanoid ids contain `_`, which is a LIKE wildcard inside JSON_SEARCH.
      { userId: "wildcard", questData: [tracker("qxb", false)] },
      { userId: "empty", questData: [] },
      { userId: "sqlnull", questData: null },
      {
        userId: "deep",
        questData: [
          ...Array.from({ length: 11 }, (_, i) => tracker(`pad-${i}`, false)),
          tracker("q_b", true),
        ],
      },
      // An objective id colliding with the quest id must not be mistaken for a tracker: the
      // search is scoped to `$[*].id`, so a recursive path would delete this goal instead.
      { userId: "goalcollision", questData: [tracker("other", false, "q_b")] },
    ]);

    await reset("q_b", ["mixed", "wildcard", "empty", "sqlnull", "deep", "goalcollision"]);

    expect(await trackerIds("mixed")).toEqual(["q_a"]);
    expect(await trackerIds("wildcard")).toEqual(["qxb"]);
    expect(await trackerIds("empty")).toEqual([]);
    expect(await trackersOf("sqlnull")).toBeNull();
    // A two-digit array index still trims to `$[11]`, not `$[1]`.
    expect(await trackerIds("deep")).not.toContain("q_b");
    expect(await trackerIds("deep")).toHaveLength(11);
    expect(await trackersOf("goalcollision")).toEqual([tracker("other", false, "q_b")]);
  });

  it("clears every copy when questData holds duplicate tracker ids", async () => {
    // One pass would promote the survivor to the tracker getNewTrackers reads, and the daily
    // would still open completed.
    await insertUsers([
      {
        userId: "twice",
        questData: [tracker("q_a", false), tracker("q_b", true), tracker("q_b", true)],
      },
      {
        userId: "thrice",
        questData: [tracker("q_b", true), tracker("q_b", true), tracker("q_b", true)],
      },
    ]);

    await reset("q_b", ["twice", "thrice"]);

    expect(await trackerIds("twice")).toEqual(["q_a"]);
    expect(await trackerIds("thrice")).toEqual([]);
  });

  it("reopens history rows and inserts one only for users who had none", async () => {
    const database = await getTestDatabase();
    await insertUsers([
      { userId: "hasrow", questData: [tracker("q_b", true)] },
      { userId: "norow", questData: [] },
    ]);
    await database
      .insert(questHistory)
      .values({
        id: "h1",
        userId: "hasrow",
        questId: "q_b",
        questType: "daily",
        completed: 1,
        endAt: new Date(),
      } as never);

    await reset("q_b", ["hasrow", "norow"]);

    const rows = await database
      .select({ userId: questHistory.userId, completed: questHistory.completed, endAt: questHistory.endAt })
      .from(questHistory)
      .where(eq(questHistory.questId, "q_b"))
      .orderBy(questHistory.userId);
    expect(rows.map((row) => row.userId)).toEqual(["hasrow", "norow"]);
    expect(rows.every((row) => row.completed === 0 && row.endAt === null)).toBe(true);
  });
})
