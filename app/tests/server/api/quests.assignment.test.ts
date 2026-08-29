// @vitest-environment node

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
    const sets: Record<string, unknown>[] = [];
    const update = vi.fn(() => ({
      set: (value: Record<string, unknown>) => {
        sets.push(value);
        return { where: vi.fn().mockResolvedValue({ rowsAffected: 1 }) };
      },
    }));
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          leftJoin: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ userId: user.userId }]) })),
      });
    const client = { select, update } as never;

    await upsertQuestEntries(
      client,
      { ...quest, questType: "daily" } as never,
      undefined as never,
    );

    expect(update).toHaveBeenCalledTimes(2);
    expect(sets[0]).toMatchObject({ completed: 0, endAt: null });
    expect(sets[1]?.questData).toBeTruthy();
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
