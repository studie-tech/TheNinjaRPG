import { describe, expect, it } from "bun:test";
import { getNewTrackers } from "@/libs/quest";
import { AllObjectives } from "@/validators/objectives";
import { trackerQuest, trackerUser } from "../../setup/quest";

// The real save path validates each objective through `AllObjectives` (quests.ts content
// schema). This exercises parse (save) → serialize → parse (load) → getNewTrackers, to catch a field being
// dropped or coerced away in the schema round-trip.
const roundTrip = (raw: Record<string, unknown>) =>
  AllObjectives.parse(JSON.parse(JSON.stringify(AllObjectives.parse(raw))));

const makeQuest = (objectives: object[]) => trackerQuest("q", objectives);

const makeUser = (quest: ReturnType<typeof makeQuest>) => trackerUser([quest]);

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
