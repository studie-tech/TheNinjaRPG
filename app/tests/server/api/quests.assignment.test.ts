// @vitest-environment node

import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";
import {
  assignQuestToUser,
  upsertQuestEntries,
  upsertQuestEntry,
} from "../../../src/server/api/routers/quests";

const quest = {
  id: "mission-1",
  name: "A-rank mission",
  questType: "mission",
  questRank: "A",
  retryDelay: "none",
  hidden: false,
  consecutiveObjectives: false,
  maxAttempts: 10,
  maxCompletes: 1,
  requiredVillage: null,
  requiredBloodlineId: null,
  prerequisiteQuestId: null,
  requiredLevel: 1,
  maxLevel: 100,
  medicalRank: null,
  huntingRank: null,
  gatheringRank: null,
  startsAt: null,
  endsAt: null,
  content: { objectives: [], reward: {}, sceneBackground: "", sceneCharacters: [] },
};

const user = {
  userId: "user-1",
  role: "USER",
  rank: "JONIN",
  level: 50,
  villageId: null,
  isOutlaw: true,
  bloodlineId: null,
  occupation: "NONE",
  medicalExperience: 0,
  huntingExperience: 0,
  gatheringExperience: 0,
  completedQuests: [],
  userQuests: [],
  questData: [],
};

/** Minimal write client for the successful upsert + daily-counter assignment path. */
const makeClient = (assignedQuest: { questId: string } | null = { questId: quest.id }) => {
  const where = vi.fn().mockResolvedValue({ rowsAffected: 1 });
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where })) }));
  const onDuplicateKeyUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn(() => ({ onDuplicateKeyUpdate }));
  const insert = vi.fn(() => ({ values }));
  const findFirst = vi.fn().mockResolvedValue(assignedQuest);
  return {
    client: {
      update,
      insert,
      query: { overworldAiPlacementQuest: { findFirst } },
    } as never,
    update,
    insert,
    findFirst,
  };
};

/**
 * Renders a drizzle `sql` fragment to its statement + bound params. The bulk reset removes the
 * tracker with raw JSON surgery, so asserting on the SET payload object alone cannot tell
 * "drop this one tracker" apart from "wipe every tracker of every user the daily cron touches".
 */
const render = (fragment: unknown) => new MySqlDialect().sqlToQuery(fragment as SQL);

/**
 * Client for the bulk reset: one LEFT JOIN select, then insert + batched updates.
 * `rowsAffected` is consumed in statement order; the removal repeats while it stays non-zero,
 * so the default models one removal, its terminating no-op pass, and the history reopen.
 */
const makeBulkClient = (
  rows: { userId: string; historyId: string | null }[],
  rowsAffected: number[] = [1, 0, 1],
) => {
  const sets: Record<string, unknown>[] = [];
  const wheres: unknown[] = [];
  const update = vi.fn(() => ({
    set: (value: Record<string, unknown>) => {
      const affected = rowsAffected[sets.length] ?? 0;
      sets.push(value);
      return {
        where: vi.fn((condition: unknown) => {
          wheres.push(condition);
          return Promise.resolve({ rowsAffected: affected });
        }),
      };
    },
  }));
  const onDuplicateKeyUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn((inserted: { userId: string }[]) => {
    void inserted;
    return { onDuplicateKeyUpdate };
  });
  const insert = vi.fn(() => ({ values }));
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      leftJoin: vi.fn(() => ({ where: vi.fn().mockResolvedValue(rows) })),
    })),
  }));
  return {
    client: { select, update, insert } as never,
    sets,
    wheres,
    update,
    insert,
    values,
    select,
  };
};

describe("assignQuestToUser compatibility", () => {
  it("preserves the successful UI mission path: history upsert, tracker write, and counter", async () => {
    const { client, update, insert } = makeClient();

    const result = await assignQuestToUser({
      client,
      user: { ...user, userQuests: [] } as never,
      quest: quest as never,
      source: "ui",
      sectorVillage: null,
      prevAttempt: undefined,
    });

    expect(result).toEqual({ success: true, message: "Quest started: A-rank mission" });
    expect(insert).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("rejects a concurrent mission before issuing any writes", async () => {
    const { client, update, insert } = makeClient();
    const activeMission = {
      id: "history-active",
      questId: "other-mission",
      questType: "mission",
      endAt: null,
      quest: { ...quest, id: "other-mission", name: "Other mission" },
    };

    const result = await assignQuestToUser({
      client,
      user: { ...user, userQuests: [activeMission] } as never,
      quest: quest as never,
      source: "ui",
      sectorVillage: null,
      prevAttempt: undefined,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Already active mission");
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps structure/occupation-gated quest types out of the NPC source", async () => {
    const { client, update, insert } = makeClient();

    const result = await assignQuestToUser({
      client,
      user: { ...user, occupation: "HUNTER", userQuests: [] } as never,
      quest: { ...quest, questType: "hunting", questRank: "B" } as never,
      source: "overworld_npc",
      prevAttempt: undefined,
    });

    expect(result).toEqual({
      success: false,
      message: "This quest type cannot be granted by an overworld NPC.",
    });
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a direct UI start for an NPC-only overworld quest without writes", async () => {
    const { client, update, insert } = makeClient();

    const result = await assignQuestToUser({
      client,
      user: { ...user, userQuests: [] } as never,
      quest: { ...quest, questType: "overworld" } as never,
      source: "ui",
      sectorVillage: null,
      prevAttempt: undefined,
    });

    expect(result).toEqual({
      success: false,
      message: "This quest can only be accepted from its assigned overworld NPC.",
    });
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("grants an overworld quest when it belongs to the interacting NPC placement", async () => {
    const { client, update, insert, findFirst } = makeClient({ questId: quest.id });

    const result = await assignQuestToUser({
      client,
      user: { ...user, userQuests: [] } as never,
      quest: { ...quest, questType: "overworld" } as never,
      source: "overworld_npc",
      overworldPlacementId: "placement-1",
      prevAttempt: undefined,
    });

    expect(result).toEqual({ success: true, message: "Quest started: A-rank mission" });
    expect(findFirst).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
  });

  it("rejects an overworld quest that is not assigned to the interacting NPC", async () => {
    const { client, update, insert } = makeClient(null);

    const result = await assignQuestToUser({
      client,
      user: { ...user, userQuests: [] } as never,
      quest: { ...quest, questType: "overworld" } as never,
      source: "overworld_npc",
      overworldPlacementId: "placement-2",
      prevAttempt: undefined,
    });

    expect(result).toEqual({
      success: false,
      message: "This quest is not assigned to this overworld NPC.",
    });
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("blocks objective and bulk assignment bypasses at the write boundary", async () => {
    const { client, update, insert } = makeClient();
    const overworldQuest = { ...quest, questType: "overworld" } as never;

    await expect(
      upsertQuestEntry(
        client,
        { ...user, userQuests: [] } as never,
        overworldQuest,
        "quest_objective",
      ),
    ).rejects.toThrow("Overworld quests can only be accepted from their assigned NPC.");
    await expect(upsertQuestEntries(client, overworldQuest, undefined as never)).rejects.toThrow(
      "Overworld quests cannot be assigned to users in bulk.",
    );
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("clears reused daily tracker progress during bulk reassignment", async () => {
    const daily = { ...quest, questType: "daily" };
    const { client, sets, wheres, update, select, insert } = makeBulkClient([
      { userId: user.userId, historyId: "history-1" },
    ]);

    await upsertQuestEntries(client, daily as never, undefined as never);

    // Both branches share the one LEFT JOIN pass; nobody is missing a history row here.
    expect(select).toHaveBeenCalledOnce();
    expect(insert).not.toHaveBeenCalled();

    // The tracker must be gone before the quest reopens, or the window in between hands out a
    // free daily: the quest is active while last run's fully-done tracker still reads resolved.
    const reopenIndex = sets.findIndex((set) => "completed" in set);
    expect(reopenIndex).toBeGreaterThan(0);
    expect(sets.slice(0, reopenIndex).every((set) => "questData" in set)).toBe(true);
    expect(reopenIndex).toBe(sets.length - 1);

    const removal = render(sets[0]?.questData);
    expect(removal.sql).toContain("JSON_REMOVE");
    // Scoped to this one tracker, not the whole document, and matched on the top-level id only.
    expect(removal.sql).toContain("JSON_SEARCH");
    expect(removal.sql).toContain("$[*].id");
    expect(removal.params).toContain(daily.id);
    // JSON_SEARCH matches with LIKE semantics and nanoid ids contain `_`, so the id has to be
    // escaped or the reset drops some other quest's tracker.
    expect(removal.sql).toContain("REPLACE(REPLACE(REPLACE(?, '#', '##'), '%', '#%'), '_', '#_')");
    // Rows with no tracker for this quest are skipped rather than written with a NULL document.
    expect(render(wheres[0]).sql).toContain("IS NOT NULL");

    expect(sets[reopenIndex]).toMatchObject({ completed: 0, endAt: null });
  });

  it("repeats the removal until a pass finds no tracker left to drop", async () => {
    // JSON_SEARCH 'one' drops a single tracker per statement, and production questData holds
    // duplicate ids; stopping after one pass leaves the survivor for getNewTrackers to reuse.
    const { client, sets } = makeBulkClient(
      [{ userId: user.userId, historyId: "history-1" }],
      [1, 1, 0, 1],
    );

    await upsertQuestEntries(
      client,
      { ...quest, questType: "daily" } as never,
      undefined as never,
    );

    const reopenIndex = sets.findIndex((set) => "completed" in set);
    expect(reopenIndex).toBe(3);
    expect(sets.slice(0, 3).every((set) => "questData" in set)).toBe(true);
  });

  it("batches distinct users when a quest has duplicate history rows", async () => {
    const daily = { ...quest, questType: "daily" };
    const { client, wheres } = makeBulkClient([
      { userId: "user-1", historyId: "history-1" },
      { userId: "user-1", historyId: "history-2" },
      { userId: "user-2", historyId: "history-3" },
    ]);

    await upsertQuestEntries(client, daily as never, undefined as never);

    const params = render(wheres[0]).params;
    expect(params.filter((param) => param === "user-1")).toHaveLength(1);
    expect(params).toContain("user-2");
  });

  it("reuses one history row lookup and inserts only for users missing a row", async () => {
    const daily = { ...quest, questType: "daily" };
    const { client, select, insert, values } = makeBulkClient([
      { userId: "user-1", historyId: "history-1" },
      { userId: "user-2", historyId: null },
    ]);

    await upsertQuestEntries(client, daily as never, undefined as never);

    expect(select).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledOnce();
    expect(values.mock.calls[0]?.[0]).toMatchObject([
      { userId: "user-2", questId: daily.id, questType: "daily" },
    ]);
  });

  it("resets stale tracker state when restarting an already-attempted quest", async () => {
    const objectiveQuest = {
      ...quest,
      content: {
        objectives: [
          {
            id: "obj-1",
            task: "items_crafted",
            value: 2,
            description: "",
            successDescription: "",
          },
        ],
        reward: {},
        sceneBackground: "",
        sceneCharacters: [],
      },
    };
    const staleTracker = {
      id: objectiveQuest.id,
      goals: [{ id: "obj-1", done: true, value: 2 }],
      startAt: new Date().toISOString(),
    };
    const existingEntry = {
      id: "history-1",
      userId: user.userId,
      questId: objectiveQuest.id,
      questType: objectiveQuest.questType,
      completed: 1,
      endAt: new Date(),
      previousAttempts: 1,
    };

    const sets: Record<string, unknown>[] = [];
    const update = vi.fn(() => ({
      set: (value: Record<string, unknown>) => {
        sets.push(value);
        return { where: vi.fn().mockResolvedValue({ rowsAffected: 1 }) };
      },
    }));
    const client = {
      update,
      insert: vi.fn(() => ({
        values: vi.fn(() => ({ onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined) })),
      })),
      query: { questHistory: { findFirst: vi.fn().mockResolvedValue(existingEntry) } },
    } as never;

    await upsertQuestEntry(
      client,
      {
        ...user,
        questData: [staleTracker],
        userQuests: [{ ...existingEntry, quest: objectiveQuest }],
      } as never,
      objectiveQuest as never,
      "system",
      existingEntry as never,
    );

    const questDataWrite = sets.find((set) => "questData" in set);
    expect(questDataWrite).toBeTruthy();
    const trackers = (questDataWrite?.questData ?? []) as {
      id: string;
      goals: { id: string; done?: boolean; value?: number }[];
    }[];
    const tracker = trackers.find((t) => t.id === objectiveQuest.id);
    const goal = tracker?.goals.find((g) => g.id === "obj-1");
    expect(goal?.done).toBe(false);
    expect(goal?.value).toBe(0);
  });
});
