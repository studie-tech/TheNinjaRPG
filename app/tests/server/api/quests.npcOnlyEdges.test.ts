// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { npcOnlyNewQuestEdgeError } from "../../../src/server/api/routers/quests";

const newQuestObjective = (id: string, newQuestIds: string[]) => ({
  id,
  task: "new_quest" as const,
  newQuestIds,
});

/** Read-only client whose `quest.findMany` answers each call in order. */
const makeClient = (...results: { id: string; name: string }[][]) => {
  const findMany = vi.fn();
  results.forEach((r) => findMany.mockResolvedValueOnce(r));
  findMany.mockResolvedValue([]);
  return { client: { query: { quest: { findMany } } } as never, findMany };
};

describe("npcOnlyNewQuestEdgeError", () => {
  it("blocks retyping a quest to overworld while another quest still starts it", async () => {
    // Quest A already starts Quest B; the only DB read is the inbound lookup, because Quest B's
    // own objectives declare no new_quest targets.
    const { client } = makeClient([{ id: "quest-a", name: "Quest A" }]);

    const error = await npcOnlyNewQuestEdgeError(client, {
      questId: "quest-b",
      questName: "Quest B",
      currentType: "mission",
      nextType: "overworld",
      objectives: [],
    });

    expect(error).toBe(
      "Cannot change this quest to overworld: it is still started by a new_quest objective in Quest A. Remove those objectives first.",
    );
  });

  it("allows the retype once no quest starts it any more", async () => {
    const { client } = makeClient([]);

    await expect(
      npcOnlyNewQuestEdgeError(client, {
        questId: "quest-b",
        questName: "Quest B",
        currentType: "mission",
        nextType: "overworld",
        objectives: [],
      }),
    ).resolves.toBeNull();
  });

  it("blocks a self-reference added in the same save, which is not stored yet", async () => {
    // Outbound lookup runs first (Quest B is still a mission in storage, so it finds nothing),
    // then the inbound lookup, which cannot see the not-yet-saved objective.
    const { client } = makeClient([], []);

    const error = await npcOnlyNewQuestEdgeError(client, {
      questId: "quest-b",
      questName: "Quest B",
      currentType: "mission",
      nextType: "overworld",
      objectives: [newQuestObjective("obj-1", ["quest-b"])] as never,
    });

    expect(error).toBe(
      "Cannot change this quest to overworld: it is still started by a new_quest objective in Quest B. Remove those objectives first.",
    );
  });

  it("allows dropping the NPC-only type off a quest that starts itself", async () => {
    // Quest B is still `overworld` in storage, so the outbound lookup returns it — but this save
    // makes it a mission, and a mission may start itself.
    const { client } = makeClient([{ id: "quest-b", name: "Quest B" }]);

    await expect(
      npcOnlyNewQuestEdgeError(client, {
        questId: "quest-b",
        questName: "Quest B",
        currentType: "overworld",
        nextType: "mission",
        objectives: [newQuestObjective("obj-1", ["quest-b"])] as never,
      }),
    ).resolves.toBeNull();
  });

  it("allows the retype when the same save removes the only self-reference", async () => {
    // The stored row still carries the self-reference the editor just deleted, so the inbound
    // lookup returns Quest B itself; the incoming objectives are the ones that count.
    const { client } = makeClient([{ id: "quest-b", name: "Quest B" }]);

    await expect(
      npcOnlyNewQuestEdgeError(client, {
        questId: "quest-b",
        questName: "Quest B",
        currentType: "mission",
        nextType: "overworld",
        objectives: [],
      }),
    ).resolves.toBeNull();
  });

  it("still blocks the outbound direction: an objective starting an NPC-only quest", async () => {
    const { client } = makeClient([{ id: "quest-b", name: "Quest B" }]);

    const error = await npcOnlyNewQuestEdgeError(client, {
      questId: "quest-a",
      questName: "Quest A",
      currentType: "mission",
      nextType: "mission",
      objectives: [newQuestObjective("obj-1", ["quest-b"])] as never,
    });

    expect(error).toBe(
      "NPC-only quests cannot be started by a new_quest objective: Quest B",
    );
  });

  it("skips the inbound lookup entirely when the type is not becoming NPC-only", async () => {
    const { client, findMany } = makeClient();

    await expect(
      npcOnlyNewQuestEdgeError(client, {
        questId: "quest-b",
        questName: "Quest B",
        currentType: "mission",
        nextType: "event",
        objectives: [],
      }),
    ).resolves.toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});
