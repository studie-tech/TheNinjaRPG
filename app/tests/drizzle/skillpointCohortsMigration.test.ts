import { beforeEach, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { quest, questHistory, userData } from "@/drizzle/schema";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuestHistory, insertQuests, insertUsers } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../setup/testDatabase";

const migration = readFileSync(
  new URL("../../drizzle/migrations/0025_hot_ken_ellis.sql", import.meta.url),
  "utf8",
).replaceAll("--> statement-breakpoint", "");
const cutoff = new Date("2026-04-22T11:32:34Z");
const beforeCutoff = new Date(cutoff.getTime() - 1_000);
const initialPoints = 37;

describeWithDatabase("skill-point cohort migration", () => {
  beforeEach(async () => {
    await resetTables(questHistory, quest, userData);
    await insertQuests([
      {
        id: "chunin-exam",
        questType: "exam",
        content: {
          objectives: [],
          reward: ObjectiveReward.parse({ reward_rank: "CHUNIN" }),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
  });

  it.each([
    { level: 20, before: 0, after: 0 },
    { level: 21, before: -1, after: 0 },
    { level: 30, before: -10, after: 0 },
    { level: 31, before: -10, after: 0 },
    { level: 40, before: -10, after: 0 },
    { level: 41, before: -9, after: 1 },
    { level: 45, before: -5, after: 5 },
    { level: 49, before: -1, after: 9 },
    { level: 50, before: 0, after: 10 },
    { level: 100, before: 0, after: 10 },
    { level: 101, before: 0, after: 0 },
  ])(
    "preserves quest-earned points across promotion cohorts at level $level",
    async ({ level, before, after }) => {
      await insertUsers(
        ["early", "late", "unknown"].map((userId) => ({
          userId,
          level,
          rank: "CHUNIN",
          skillPoints: initialPoints,
        })),
      );
      await insertQuestHistory([
        { userId: "early", questId: "chunin-exam", completed: 1, endAt: beforeCutoff },
        { userId: "late", questId: "chunin-exam", completed: 1, endAt: cutoff },
      ]);
      await runRawSql(migration);
      const rows = await (await getTestDatabase()).query.userData.findMany();
      expect(
        Object.fromEntries(rows.map((row) => [row.userId, row.skillPoints])),
      ).toEqual({
        early: initialPoints + before,
        late: initialPoints + after,
        unknown: initialPoints + after,
      });
    },
  );

  it("requires a completed Chunin exam to classify an early promotion", async () => {
    await insertQuests([
      {
        id: "genin-exam",
        questType: "exam",
        content: {
          objectives: [],
          reward: ObjectiveReward.parse({ reward_rank: "GENIN" }),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
      {
        id: "chunin-event",
        questType: "event",
        content: {
          objectives: [],
          reward: ObjectiveReward.parse({ reward_rank: "CHUNIN" }),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
    await insertUsers(
      ["unfinished", "wrong-rank", "wrong-type"].map((userId) => ({
        userId,
        level: 45,
        rank: "CHUNIN",
        skillPoints: initialPoints,
      })),
    );
    await insertQuestHistory([
      {
        userId: "unfinished",
        questId: "chunin-exam",
        completed: 0,
        endAt: beforeCutoff,
      },
      {
        userId: "wrong-rank",
        questId: "genin-exam",
        completed: 1,
        endAt: beforeCutoff,
      },
      {
        userId: "wrong-type",
        questId: "chunin-event",
        completed: 1,
        endAt: beforeCutoff,
      },
    ]);
    await runRawSql(migration);
    const rows = await (await getTestDatabase()).query.userData.findMany();
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.skillPoints).toBe(initialPoints + 5);
  });

  it.each(["CHUNIN", "JONIN", "ELITE JONIN", "ELDER"] as const)(
    "adjusts player %s points while excluding AI and unpromoted users",
    async (rank) => {
      await insertUsers([
        { userId: "player", rank, level: 45, skillPoints: initialPoints },
        { userId: "ai", rank, level: 45, skillPoints: initialPoints, isAi: true },
        { userId: "genin", rank: "GENIN", level: 45, skillPoints: initialPoints },
        { userId: "student", rank: "STUDENT", level: 45, skillPoints: initialPoints },
        { userId: "capped", rank, level: 50, skillPoints: 99 },
      ]);
      await runRawSql(migration);
      const rows = await (await getTestDatabase()).query.userData.findMany();
      expect(
        Object.fromEntries(rows.map((row) => [row.userId, row.skillPoints])),
      ).toEqual({
        player: initialPoints + 5,
        ai: initialPoints,
        genin: initialPoints,
        student: initialPoints,
        capped: 100,
      });
    },
  );
});
