// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Runs migration 0039 — deduplicate QuestHistory, then add uniqueUserIdQuestId — against a real
 * MySQL, so the winner it keeps and the counters it merges are checked rather than assumed.
 *
 * Set TEST_MYSQL_URL to a THROWAWAY database — this creates and drops `QuestHistory` in it:
 *   TEST_MYSQL_URL='mysql://root:placeholder@127.0.0.1:3307/tnr_test' bun test
 */
const url = process.env.TEST_MYSQL_URL;
const dbName = url ? new URL(url).pathname.replace(/^\//, "") : "";
const enabled = !!url && /test/i.test(dbName);

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

let connection: mysql.Connection;

type Row = {
  id: string;
  userId: string;
  questId: string;
  completed?: number;
  endedAt?: Date | null;
  startedAt: string;
  previousCompletes?: number;
  previousAttempts?: number;
};

const seed = async (rows: Row[]) => {
  await connection.query(
    "INSERT INTO QuestHistory (id, userId, questId, questType, completed, endedAt, startedAt, previousCompletes, previousAttempts) VALUES ?",
    [
      rows.map((row) => [
        row.id,
        row.userId,
        row.questId,
        "tier",
        row.completed ?? 0,
        row.endedAt ?? null,
        row.startedAt,
        row.previousCompletes ?? 0,
        row.previousAttempts ?? 0,
      ]),
    ],
  );
};

const migrate = async () => {
  for (const statement of statements) {
    await connection.query(statement);
  }
};

const survivors = async () => {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT id, userId, questId, completed, endedAt, previousCompletes, previousAttempts FROM QuestHistory ORDER BY userId, questId",
  );
  return rows;
};

describe.skipIf(!enabled)("QuestHistory unique (userId, questId) migration", () => {
  beforeAll(async () => {
    connection = await mysql.createConnection({ uri: url, multipleStatements: true });
    expect(statements).toHaveLength(3);
  });

  afterAll(async () => {
    await connection?.query("DROP TABLE IF EXISTS QuestHistory");
    await connection?.end();
  });

  beforeEach(async () => {
    // Rebuilt per test so each run starts from the pre-migration shape: no unique key.
    await connection.query(`
      DROP TABLE IF EXISTS QuestHistory;
      CREATE TABLE QuestHistory (
        id varchar(191) NOT NULL PRIMARY KEY,
        userId varchar(191) NOT NULL,
        questId varchar(191) NOT NULL,
        questType varchar(191) NOT NULL,
        completed tinyint NOT NULL DEFAULT 0,
        endedAt datetime(3) NULL,
        startedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        previousCompletes int NOT NULL DEFAULT 0,
        previousAttempts int NOT NULL DEFAULT 0,
        periodCompletes int NOT NULL DEFAULT 0,
        periodStartAt datetime(3) NULL
      );
    `);
  });

  it("keeps the open attempt and lifts the highest lifetime counters onto it", async () => {
    await seed([
      // Newer, but finished — losing to the open attempt is the point.
      {
        id: "closed",
        userId: "u1",
        questId: "q1",
        completed: 1,
        endedAt: new Date("2026-05-01T00:00:00Z"),
        startedAt: "2026-05-01 00:00:00.000",
        previousCompletes: 3,
        previousAttempts: 9,
      },
      {
        id: "open",
        userId: "u1",
        questId: "q1",
        completed: 0,
        endedAt: null,
        startedAt: "2026-01-01 00:00:00.000",
        previousCompletes: 1,
        previousAttempts: 2,
      },
    ]);

    await migrate();

    const rows = await survivors();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("open");
    expect(rows[0]?.previousCompletes).toBe(3);
    expect(rows[0]?.previousAttempts).toBe(9);
  });

  it("falls back to the most recently started attempt when none is open", async () => {
    await seed([
      {
        id: "older",
        userId: "u1",
        questId: "q1",
        completed: 1,
        endedAt: new Date("2026-01-02T00:00:00Z"),
        startedAt: "2026-01-01 00:00:00.000",
      },
      {
        id: "newer",
        userId: "u1",
        questId: "q1",
        completed: 1,
        endedAt: new Date("2026-06-02T00:00:00Z"),
        startedAt: "2026-06-01 00:00:00.000",
      },
    ]);

    await migrate();

    const rows = await survivors();
    expect(rows.map((row) => row.id)).toEqual(["newer"]);
  });

  it("collapses a deep group and leaves unduplicated pairs untouched", async () => {
    await seed([
      ...Array.from({ length: 28 }, (_, i) => ({
        id: `dupe-${i}`,
        userId: "u1",
        questId: "q1",
        completed: 1,
        endedAt: new Date("2026-01-02T00:00:00Z"),
        startedAt: `2026-01-${String(i + 1).padStart(2, "0")} 00:00:00.000`,
        previousAttempts: i,
      })),
      { id: "solo", userId: "u2", questId: "q1", startedAt: "2026-01-01 00:00:00.000" },
      { id: "other", userId: "u1", questId: "q2", startedAt: "2026-01-01 00:00:00.000" },
    ]);

    await migrate();

    const rows = await survivors();
    expect(rows.map((row) => row.id).sort()).toEqual(["dupe-27", "other", "solo"].sort());
    expect(rows.find((row) => row.id === "dupe-27")?.previousAttempts).toBe(27);
  });

  it("adds the constraint so a second row for the same pair is rejected", async () => {
    await seed([
      { id: "a", userId: "u1", questId: "q1", startedAt: "2026-01-01 00:00:00.000" },
      { id: "b", userId: "u1", questId: "q1", startedAt: "2026-01-02 00:00:00.000" },
    ]);

    await migrate();

    await expect(
      seed([{ id: "c", userId: "u1", questId: "q1", startedAt: "2026-02-01 00:00:00.000" }]),
    ).rejects.toThrow(/Duplicate entry/i);

    // The key the app's onDuplicateKeyUpdate relies on, by the name schema.ts declares.
    const [indexes] = await connection.query<mysql.RowDataPacket[]>(
      "SHOW INDEX FROM QuestHistory WHERE Key_name = 'uniqueUserIdQuestId'",
    );
    expect(indexes.map((row) => row.Column_name)).toEqual(["userId", "questId"]);
    expect(indexes.every((row) => row.Non_unique === 0)).toBe(true);
  });

  it("is a no-op when the table already holds one row per pair", async () => {
    await seed([
      { id: "a", userId: "u1", questId: "q1", startedAt: "2026-01-01 00:00:00.000" },
      { id: "b", userId: "u2", questId: "q1", startedAt: "2026-01-01 00:00:00.000" },
    ]);

    await migrate();

    expect((await survivors()).map((row) => row.id)).toEqual(["a", "b"]);
  });
});
