// @vitest-environment node

import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { questHistory, userData } from "@/drizzle/schema";
import { upsertQuestEntries } from "../../../src/server/api/routers/quests";

/**
 * The bulk daily reset clears a tracker with raw JSON surgery (JSON_SEARCH + JSON_REMOVE). The
 * other suites assert the statement drizzle renders; these run it on a real MySQL, because the
 * rendered string says nothing about whether the engine drops the element you meant.
 *
 * Set TEST_MYSQL_URL to a THROWAWAY database — this creates and drops `UserData` and
 * `QuestHistory` in it. CI provides one; locally the dev stack's MySQL works:
 *   TEST_MYSQL_URL='mysql://root:placeholder@127.0.0.1:3307/tnr_test' bun test
 */
const url = process.env.TEST_MYSQL_URL;
const dbName = url ? new URL(url).pathname.replace(/^\//, "") : "";
// Refuse a database whose name does not look disposable: the setup drops real table names.
const enabled = !!url && /test/i.test(dbName);

let connection: mysql.Connection;
let client: Parameters<typeof upsertQuestEntries>[0];

const tracker = (id: string, done: boolean) =>
  ({ id, startAt: "2026-01-01T00:00:00.000Z", goals: [{ id: "o1", done, value: 1 }] }) as const;

const questDataOf = async (userId: string) => {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT questData FROM UserData WHERE userId = ?",
    [userId],
  );
  const value = rows[0]?.questData;
  return (typeof value === "string" ? JSON.parse(value) : value) as { id: string }[] | null;
};

const trackerIds = async (userId: string) =>
  ((await questDataOf(userId)) ?? []).map((entry) => entry.id);

describe.skipIf(!enabled)("bulk daily reset against a real MySQL", () => {
  beforeAll(async () => {
    connection = await mysql.createConnection({ uri: url, multipleStatements: true });
    // Mirrors production, which has no unique key on (userId, questId).
    await connection.query(`
      DROP TABLE IF EXISTS UserData;
      DROP TABLE IF EXISTS QuestHistory;
      CREATE TABLE UserData (userId varchar(191) NOT NULL PRIMARY KEY, questData json);
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
    const db = drizzle(connection);
    // upsertQuestEntries reads rowsAffected to decide whether another removal pass is needed;
    // the mysql2 driver reports it as [ResultSetHeader], so normalise it here only.
    client = {
      select: db.select.bind(db),
      insert: db.insert.bind(db),
      update: (table: Parameters<typeof db.update>[0]) => {
        const builder = db.update(table);
        return {
          set: (values: Record<string, unknown>) => {
            const withValues = builder.set(values);
            return {
              where: async (condition: Parameters<typeof withValues.where>[0]) => {
                const result = await withValues.where(condition);
                const header = Array.isArray(result) ? result[0] : result;
                return { rowsAffected: header.affectedRows ?? 0 };
              },
            };
          },
        };
      },
    } as unknown as Parameters<typeof upsertQuestEntries>[0];
  });

  afterAll(async () => {
    await connection?.query("DROP TABLE IF EXISTS UserData; DROP TABLE IF EXISTS QuestHistory;");
    await connection?.end();
  });

  beforeEach(async () => {
    await connection.query("DELETE FROM UserData; DELETE FROM QuestHistory;");
  });

  const reset = async (questId: string, userIds: string[]) =>
    upsertQuestEntries(
      client,
      { id: questId, questType: "daily" } as never,
      inArray(userData.userId, userIds) as never,
    );

  it("drops only the reassigned quest's tracker, across every production questData shape", async () => {
    // `q_b` vs `qxb`: nanoid ids contain `_`, which is a LIKE wildcard inside JSON_SEARCH.
    await connection.query(
      "INSERT INTO UserData (userId, questData) VALUES (?,?),(?,?),(?,?),(?,?),(?,?),(?,?)",
      [
        "mixed", JSON.stringify([tracker("q_a", true), tracker("q_b", true)]),
        "wildcard", JSON.stringify([tracker("qxb", false)]),
        "empty", JSON.stringify([]),
        "sqlnull", null,
        "deep", JSON.stringify([
          ...Array.from({ length: 11 }, (_, i) => tracker(`pad-${i}`, false)),
          tracker("q_b", true),
        ]),
        // An objective id that collides with the quest id must not be mistaken for a tracker:
        // the search is scoped to `$[*].id`, so a recursive path would delete this goal instead.
        "goalcollision", JSON.stringify([
          { id: "other", startAt: "2026-01-01T00:00:00.000Z", goals: [{ id: "q_b", done: false }] },
        ]),
      ],
    );

    await reset("q_b", ["mixed", "wildcard", "empty", "sqlnull", "deep", "goalcollision"]);

    expect(await trackerIds("mixed")).toEqual(["q_a"]);
    expect(await trackerIds("wildcard")).toEqual(["qxb"]);
    expect(await trackerIds("empty")).toEqual([]);
    expect(await questDataOf("sqlnull")).toBeNull();
    // A two-digit array index still trims to `$[11]`, not `$[1]`.
    expect(await trackerIds("deep")).not.toContain("q_b");
    expect(await trackerIds("deep")).toHaveLength(11);
    expect(await questDataOf("goalcollision")).toEqual([
      { id: "other", startAt: "2026-01-01T00:00:00.000Z", goals: [{ id: "q_b", done: false }] },
    ]);
  });

  it("clears every copy when questData holds duplicate tracker ids", async () => {
    // One pass would promote the survivor to the tracker getNewTrackers reads, and the daily
    // would still open completed.
    await connection.query("INSERT INTO UserData (userId, questData) VALUES (?,?),(?,?)", [
      "twice", JSON.stringify([tracker("q_a", false), tracker("q_b", true), tracker("q_b", true)]),
      "thrice", JSON.stringify([tracker("q_b", true), tracker("q_b", true), tracker("q_b", true)]),
    ]);

    await reset("q_b", ["twice", "thrice"]);

    expect(await trackerIds("twice")).toEqual(["q_a"]);
    expect(await trackerIds("thrice")).toEqual([]);
  });

  it("reopens history rows and inserts one only for users who had none", async () => {
    await connection.query("INSERT INTO UserData (userId, questData) VALUES (?,?),(?,?)", [
      "hasrow", JSON.stringify([tracker("q_b", true)]),
      "norow", JSON.stringify([]),
    ]);
    await connection.query(
      "INSERT INTO QuestHistory (id, userId, questId, questType, completed, endedAt) VALUES (?,?,?,?,?,?)",
      ["h1", "hasrow", "q_b", "daily", 1, new Date()],
    );

    await reset("q_b", ["hasrow", "norow"]);

    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT userId, completed, endedAt FROM QuestHistory WHERE questId = 'q_b' ORDER BY userId",
    );
    expect(rows.map((row) => row.userId)).toEqual(["hasrow", "norow"]);
    expect(rows.every((row) => row.completed === 0 && row.endedAt === null)).toBe(true);
  });

  it("reopens every duplicate history row without inserting another", async () => {
    // Rows that predate the uniqueUserIdQuestId constraint can still pair up this way.
    await connection.query("INSERT INTO UserData (userId, questData) VALUES (?,?)", [
      "dupe", JSON.stringify([tracker("q_b", true)]),
    ]);
    await connection.query(
      "INSERT INTO QuestHistory (id, userId, questId, questType, completed, endedAt) VALUES (?,?,?,?,?,?),(?,?,?,?,?,?)",
      ["h1", "dupe", "q_b", "daily", 1, new Date(), "h2", "dupe", "q_b", "daily", 1, new Date()],
    );

    await reset("q_b", ["dupe"]);

    expect(await trackerIds("dupe")).toEqual([]);
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM QuestHistory WHERE userId = 'dupe' AND completed = 0 AND endedAt IS NULL",
    );
    // Both existing rows reopen; the LEFT JOIN fan-out must not add a third.
    expect(Number(rows[0]?.n)).toBe(2);
  });
});
