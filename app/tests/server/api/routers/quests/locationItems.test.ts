import { afterEach, describe, expect, it, vi } from "bun:test";
import { questsRouter } from "@/routers/quests";
import { CollectItem, QuestTracker } from "@/validators/objectives";
import { resetServerModuleStubs, stubProfile } from "../../../../setup/serverModules";
import { withEmptyIsolationHistory } from "../../../../setup/testDatabase";

const makeCaller = (
  consequences: { type: string; ids: string[]; questId?: string }[] = [],
  collect = false,
  missingUser = false,
  entryPaid?: boolean,
  craftingItemsChanged = false,
) => {
  const location = { sector: 1, longitude: 1, latitude: 1 };
  const quest = {
    id: "collection",
    name: "Collection",
    questType: "mission",
    hidden: false,
    consecutiveObjectives: false,
    maxAttempts: 100,
    maxCompletes: 100,
    retryDelay: "none",
    requiredVillage: null,
    content: {
      entryItems: entryPaid === undefined ? [] : [{ ids: ["ticket"], number: 1 }],
      objectives: collect
        ? [
            CollectItem.parse({
              id: "collect",
              task: "collect_item",
              ...location,
              collectItemIds: ["scroll"],
            }),
          ]
        : [],
      reward: {},
    },
  };
  const user = {
    userId: "walker",
    updatedAt: new Date(),
    level: 50,
    rank: "JONIN",
    role: "USER",
    status: "AWAKE",
    ...location,
    items: [],
    activeWars: [],
    completedQuests: [],
    questData:
      collect || entryPaid !== undefined ? [QuestTracker.parse({ id: quest.id })] : [],
    userQuests:
      collect || entryPaid !== undefined
        ? [{ id: "history", questId: quest.id, completed: 0, entryPaid, quest }]
        : [],
  };
  stubProfile("fetchUpdatedUser", (async () => ({
    user: missingUser ? undefined : user,
    trackerResults: { consequences, notifications: [], questIdsUpdated: [] },
    craftingItemsChanged,
  })) as never);
  const insertItems = vi.fn().mockResolvedValue({ rowsAffected: 1 });
  const drizzle = withEmptyIsolationHistory({
    query: { userItem: { findMany: vi.fn().mockResolvedValue([]) } },
    update: () => ({ set: () => ({ where: async () => ({ rowsAffected: 1 }) }) }),
    insert: () => ({ values: insertItems }),
  });
  return {
    caller: questsRouter.createCaller({ drizzle, userId: "walker" } as never),
    insertItems,
  };
};

describe("location quest inventory signal", () => {
  afterEach(resetServerModuleStubs);

  it("does not request an inventory refresh for a quest-less crossing", async () => {
    const { caller, insertItems } = makeCaller();
    expect(await caller.checkLocationQuest()).toMatchObject({
      success: true,
      itemsChanged: false,
    });
    expect(insertItems).not.toHaveBeenCalled();
  });

  it.each(["add_item", "remove_item"])(
    "reports %s consequences from the profile pass even when the location pass is empty",
    async (type) => {
      const { caller, insertItems } = makeCaller([{ type, ids: ["scroll"] }]);
      expect((await caller.checkLocationQuest()).itemsChanged).toBe(true);
      // The profile pass already handled these consequences; do not replay them.
      expect(insertItems).not.toHaveBeenCalled();
    },
  );

  it("ignores empty item consequences and progress-only consequences", async () => {
    const { caller } = makeCaller([
      { type: "add_item", ids: [] },
      { type: "remove_item", ids: [] },
      { type: "update_user", ids: ["location_update"] },
    ]);
    expect((await caller.checkLocationQuest()).itemsChanged).toBe(false);
  });

  it("reports crafting settlement without quest consequences", async () => {
    const { caller } = makeCaller([], false, false, undefined, true);
    expect((await caller.checkLocationQuest()).itemsChanged).toBe(true);
  });

  it("reports and grants items collected in the location pass", async () => {
    const { caller, insertItems } = makeCaller([], true);
    expect((await caller.checkLocationQuest()).itemsChanged).toBe(true);
    expect(insertItems).toHaveBeenCalledTimes(1);
    expect(insertItems.mock.calls[0]?.[0]).toMatchObject([
      { userId: "walker", itemId: "scroll", quantity: 1 },
    ]);
  });

  it.each([false, true])(
    "refreshes inventory for combat even if entry was already paid (entryPaid: %s)",
    async (entryPaid) => {
      const { caller } = makeCaller(
        [{ type: "combat", ids: ["opponent"], questId: "collection" }],
        false,
        false,
        entryPaid,
      );
      expect((await caller.checkLocationQuest()).itemsChanged).toBe(true);
    },
  );

  it("refreshes inventory for combat without entry costs because battle setup can settle crafts", async () => {
    const { caller } = makeCaller([{ type: "combat", ids: ["opponent"] }]);
    expect((await caller.checkLocationQuest()).itemsChanged).toBe(true);
  });

  it("returns a false signal when the user is missing", async () => {
    const { caller } = makeCaller([], false, true);
    expect(await caller.checkLocationQuest()).toEqual({
      success: false,
      itemsChanged: false,
      notifications: [],
    });
  });
});
