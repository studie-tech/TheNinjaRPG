// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asc } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { questHistory } from "@/drizzle/schema";
import { insertQuestHistory } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  indexColumns,
  resetTables,
  runRawSql,
} from "../../setup/testDatabase";

/**
 * Runs migration 0039 — deduplicate QuestHistory, then add uniqueUserIdQuestId — against a real
 * MySQL, so the row it keeps and the counters it merges are checked rather than assumed.
 */
const statements = readFileSync(
  join(
    import.meta.dirname,
    "../../../drizzle/migrations/0039_quest_history_unique_user_quest.sql",
  ),
  "utf8",
)
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

const applyMigration = async () => {
  for (const statement of statements) {
    await runRawSql(statement);
  }
};

const survivors = async () => {
  const database = await getTestDatabase();
  return database
    .select({
      id: questHistory.id,
      userId: questHistory.userId,
      previousCompletes: questHistory.previousCompletes,
      previousAttempts: questHistory.previousAttempts,
    })
    .from(questHistory)
    .orderBy(asc(questHistory.id));
};

const at = (iso: string) => new Date(iso);

describeWithDatabase("QuestHistory unique (userId, questId) migration", () => {
  beforeEach(async () => {
    await resetTables(questHistory);
    // The schema already carries the constraint, so drop it to reach the pre-migration shape
    // the deployed database is in.
    await runRawSql("ALTER TABLE `QuestHistory` DROP INDEX `uniqueUserIdQuestId`");
  });

  afterEach(async () => {
    // Leave the schema as the rest of the suite expects, whatever this test did.
    await resetTables(questHistory);
    await runRawSql(
      "ALTER TABLE `QuestHistory` ADD CONSTRAINT `uniqueUserIdQuestId` UNIQUE(`userId`,`questId`)",
    ).catch(() => undefined);
  });

  it("has the three statements the assertions below depend on", () => {
    expect(statements).toHaveLength(3);
  });

  it("keeps the open attempt and lifts the highest lifetime counters onto it", async () => {
    await insertQuestHistory([
      // Newer, but finished — losing to the open attempt is the point.
      {
        id: "closed",
        userId: "u1",
        questId: "q1",
        completed: 1,
        endAt: at("2026-05-02T00:00:00Z"),
        startedAt: at("2026-05-01T00:00:00Z"),
        previousCompletes: 3,
        previousAttempts: 9,
      },
      {
        id: "open",
        userId: "u1",
        questId: "q1",
        completed: 0,
        endAt: null,
        startedAt: at("2026-01-01T00:00:00Z"),
        previousCompletes: 1,
        previousAttempts: 2,
      },
    ]);

    await applyMigration();

    expect(await survivors()).toEqual([
      { id: "open", userId: "u1", previousCompletes: 3, previousAttempts: 9 },
    ]);
  });

  it("falls back to the most recently started attempt when none is open", async () => {
    await insertQuestHistory([
      {
        id: "older",
        userId: "u1",
        questId: "q1",
        completed: 1,
        endAt: at("2026-01-02T00:00:00Z"),
        startedAt: at("2026-01-01T00:00:00Z"),
      },
      {
        id: "newer",
        userId: "u1",
        questId: "q1",
        completed: 1,
        endAt: at("2026-06-02T00:00:00Z"),
        startedAt: at("2026-06-01T00:00:00Z"),
      },
    ]);

    await applyMigration();

    expect((await survivors()).map((row) => row.id)).toEqual(["newer"]);
  });

  it("keeps a survivor whose id contains the characters used to build the sort key", async () => {
    // id is varchar(191); a separator-based key would truncate here, match no row, and delete
    // the whole group. The key is fixed width instead, so the id is recovered intact.
    await insertQuestHistory([
      {
        id: "open|attempt 2026",
        userId: "u1",
        questId: "q1",
        completed: 0,
        endAt: null,
        startedAt: at("2026-01-01T00:00:00Z"),
      },
      {
        id: "loser",
        userId: "u1",
        questId: "q1",
        completed: 1,
        endAt: at("2026-05-02T00:00:00Z"),
        startedAt: at("2026-05-01T00:00:00Z"),
      },
    ]);

    await applyMigration();

    expect((await survivors()).map((row) => row.id)).toEqual(["open|attempt 2026"]);
  });

  it("collapses a deep group and leaves unduplicated pairs untouched", async () => {
    await insertQuestHistory([
      ...Array.from({ length: 28 }, (_, i) => ({
        id: `dupe-${String(i).padStart(2, "0")}`,
        userId: "u1",
        questId: "q1",
        completed: 1,
        endAt: at("2026-01-02T00:00:00Z"),
        startedAt: at(`2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
        previousAttempts: i,
      })),
      { id: "solo", userId: "u2", questId: "q1" },
      { id: "other", userId: "u1", questId: "q2" },
    ]);

    await applyMigration();

    const rows = await survivors();
    expect(rows.map((row) => row.id).sort()).toEqual(["dupe-27", "other", "solo"]);
    expect(rows.find((row) => row.id === "dupe-27")?.previousAttempts).toBe(27);
  });

  it("adds the constraint so a second row for the same pair is rejected", async () => {
    await insertQuestHistory([
      { id: "a", userId: "u1", questId: "q1" },
      { id: "b", userId: "u1", questId: "q1" },
    ]);

    await applyMigration();

    // drizzle wraps driver errors, so read the cause for the reason the insert was refused.
    const failure: unknown = await insertQuestHistory([
      { id: "c", userId: "u1", questId: "q1" },
    ]).catch((error: unknown) => error);
    const cause = (failure as { cause?: { message?: string } })?.cause?.message;
    expect(cause ?? String(failure)).toMatch(/Duplicate entry/i);
    // The key the app's onDuplicateKeyUpdate relies on, by the name schema.ts declares.
    expect(await indexColumns("QuestHistory", "uniqueUserIdQuestId")).toEqual({
      columns: ["userId", "questId"],
      unique: true,
    });
  });

  it("is a no-op when the table already holds one row per pair", async () => {
    await insertQuestHistory([
      { id: "a", userId: "u1", questId: "q1" },
      { id: "b", userId: "u2", questId: "q1" },
    ]);

    await applyMigration();

    expect((await survivors()).map((row) => row.id)).toEqual(["a", "b"]);
  });
})
