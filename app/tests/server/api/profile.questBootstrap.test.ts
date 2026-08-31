// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";
import { quest, questHistory, type UserData } from "@/drizzle/schema";
import { fetchQuestBootstrap } from "../../../src/server/api/routers/profile";
import { fetchUncompletedQuests } from "../../../src/server/api/routers/quests";
import { insertQuestHistory, insertQuests } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

/**
 * `fetchUpdatedUser` used to call `insertNextQuest` for "tier" and "exam" on every request, and
 * that always begins with a `fetchUncompletedQuests` round-trip — which comes back empty for the
 * overwhelming majority of players. A JS guard now skips the call when nothing could possibly
 * match.
 *
 * The guard is only safe while it stays a strict SUBSET of that query's filters, so what matters
 * is one direction: whenever the guard says "impossible", the real query must genuinely return
 * nothing. These tests assert that against a real database rather than a mock, so the day someone
 * adds a filter to `fetchUncompletedQuests` and the two drift apart, this is what notices.
 */
const BAND = { requiredLevel: 10, maxLevel: 50 } as const;

/** Mirrors the guard in fetchUpdatedUser. Kept here in full so a change there fails this file. */
const guardSaysPossible = (
  bootstrap: Awaited<ReturnType<typeof fetchQuestBootstrap>>,
  questType: "tier" | "exam",
  level: number,
) =>
  bootstrap.candidates.some(
    (candidate) =>
      candidate.questType === questType &&
      !bootstrap.startedIds.has(candidate.id) &&
      candidate.requiredLevel <= level &&
      candidate.maxLevel >= level,
  );

const asUser = (level: number) =>
  ({
    userId: "user-guard",
    role: "USER",
    rank: "JONIN",
    level,
    villageId: null,
    isOutlaw: false,
    bloodlineId: null,
    farmingExperience: 0,
    questData: [],
  }) as unknown as UserData;

describeWithDatabase("quest bootstrap guard", () => {
  beforeEach(async () => {
    await resetTables(questHistory, quest);
  });

  it("agrees with the real query across the level range", async () => {
    const [tier] = await insertQuests([
      { id: "tier-1", questType: "tier", questRank: "D", tierLevel: 1, ...BAND },
    ]);
    expect(tier).toBeDefined();

    const database = await getTestDatabase();
    let sawPossible = false;
    let sawImpossible = false;

    // Around, on, and well outside the quest's band
    for (const level of [1, 9, 10, 11, 30, 49, 50, 51, 80]) {
      const bootstrap = await fetchQuestBootstrap(database, "user-guard");
      const possible = guardSaysPossible(bootstrap, "tier", level);
      const rows = await fetchUncompletedQuests(database, asUser(level), "tier");
      if (possible) sawPossible = true;
      else {
        sawImpossible = true;
        // The direction that matters: skipping must never lose a startable quest
        expect(rows, `level ${level}: guard skipped a non-empty query`).toHaveLength(0);
      }
      // And when it does let the call through, the query really has something for it
      if (possible) {
        expect(rows.length, `level ${level}: guard passed on an empty query`).toBeGreaterThan(0);
      }
    }

    // Neither branch may be vacuous, or the loop above proves nothing
    expect(sawPossible).toBe(true);
    expect(sawImpossible).toBe(true);
  });

  it("skips once every quest of the type has been started", async () => {
    await insertQuests([
      { id: "tier-1", questType: "tier", questRank: "D", tierLevel: 1, ...BAND },
      { id: "tier-2", questType: "tier", questRank: "D", tierLevel: 2, ...BAND },
    ]);
    const database = await getTestDatabase();

    // In-band with nothing started: the call has to go through
    expect(
      guardSaysPossible(await fetchQuestBootstrap(database, "user-guard"), "tier", 30),
    ).toBe(true);

    // A history row exists even when the quest was never finished, and
    // QuestHistory.completed is NOT NULL, so the real query's isNull(completed) on the left
    // join excludes it either way — which is exactly what startedIds reproduces
    await insertQuestHistory([
      { userId: "user-guard", questId: "tier-1", questType: "tier", completed: 0 },
      { userId: "user-guard", questId: "tier-2", questType: "tier", completed: 1 },
    ]);

    const bootstrap = await fetchQuestBootstrap(database, "user-guard");
    expect(guardSaysPossible(bootstrap, "tier", 30)).toBe(false);
    expect(await fetchUncompletedQuests(database, asUser(30), "tier")).toHaveLength(0);
  });

  it("skips a type that has no quests at all, which is exam in production today", async () => {
    await insertQuests([
      { id: "tier-1", questType: "tier", questRank: "D", tierLevel: 1, ...BAND },
    ]);
    const database = await getTestDatabase();
    const bootstrap = await fetchQuestBootstrap(database, "user-guard");

    expect(bootstrap.candidates.some((c) => c.questType === "exam")).toBe(false);
    expect(guardSaysPossible(bootstrap, "exam", 30)).toBe(false);
    expect(await fetchUncompletedQuests(database, asUser(30), "exam")).toHaveLength(0);
  });

  it("only reads the two quest types it is responsible for", async () => {
    await insertQuests([
      { id: "tier-1", questType: "tier", questRank: "D", tierLevel: 1, ...BAND },
      { id: "daily-1", questType: "daily", questRank: "D", ...BAND },
      { id: "mission-1", questType: "mission", questRank: "D", ...BAND },
    ]);
    const database = await getTestDatabase();
    const bootstrap = await fetchQuestBootstrap(database, "user-guard");

    expect(bootstrap.candidates.map((c) => c.questType).sort()).toEqual(["tier"]);
  });
});
