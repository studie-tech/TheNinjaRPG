import { describe, expect, it } from "vitest";
import { getNewTrackers } from "@/libs/quest";
import { AllObjectives } from "@/validators/objectives";

// The real save path validates each objective through `AllObjectives` (quests.ts content
// schema). Prior tests built the objective as a raw JS object, skipping this parse. This
// exercises parse (save) → serialize → parse (load) → getNewTrackers, to catch a field being
// dropped or coerced away in the schema round-trip.
const roundTrip = (raw: Record<string, unknown>) =>
  AllObjectives.parse(JSON.parse(JSON.stringify(AllObjectives.parse(raw))));

const makeQuest = (objectives: unknown[]) => ({
  id: "q",
  name: "Quest q",
  questType: "daily" as const,
  hidden: false,
  consecutiveObjectives: false,
  maxAttempts: 100,
  maxCompletes: 100,
  requiredVillage: null,
  requiredBloodlineId: null,
  prerequisiteQuestId: null,
  requiredLevel: null,
  maxLevel: null,
  medicalRank: null,
  huntingRank: null,
  gatheringRank: null,
  endsAt: null,
  content: { objectives, reward: {}, sceneBackground: "", sceneCharacters: [] },
});

const makeUser = (quest: ReturnType<typeof makeQuest>) =>
  ({
    userId: "u1",
    level: 50,
    villageId: "v1",
    isOutlaw: false,
    bloodlineId: null,
    sector: 1,
    village: { id: "v1", sector: 1 },
    activeWars: [],
    completedQuests: [],
    questData: [],
    userQuests: [{ id: "uq", questId: "q", completed: 0, quest }],
  }) as unknown as Parameters<typeof getNewTrackers>[0];

describe("craft_specific_item survives the real schema round-trip", () => {
  it("keeps craftItemIds through AllObjectives parse and still credits the craft", () => {
    const objective = roundTrip({
      id: "o",
      task: "craft_specific_item",
      craftItemIds: ["item-1"],
      value: 1,
    });
    // The field the matcher reads must survive parsing.
    expect((objective as { craftItemIds?: string[] }).craftItemIds).toEqual(["item-1"]);

    const result = getNewTrackers(makeUser(makeQuest([objective])), [
      { task: "craft_specific_item", increment: 1, contentId: "item-1" },
    ]);
    const goal = result.trackers
      .find((t) => t.id === "q")
      ?.goals.find((g) => g.id === "o");
    expect(goal?.value).toBe(1);
    expect(goal?.done).toBe(true);
  });

  it("use_specific_item_combat keeps useItemIds through the round-trip", () => {
    const objective = roundTrip({
      id: "o",
      task: "use_specific_item_combat",
      useItemIds: ["item-1"],
      value: 1,
    });
    expect((objective as { useItemIds?: string[] }).useItemIds).toEqual(["item-1"]);

    const result = getNewTrackers(makeUser(makeQuest([objective])), [
      { task: "use_specific_item_combat", increment: 1, contentId: "item-1" },
    ]);
    const goal = result.trackers
      .find((t) => t.id === "q")
      ?.goals.find((g) => g.id === "o");
    expect(goal?.value).toBe(1);
  });
});
