import { describe, expect, it } from "bun:test";
import { getCraftTrackerTasks, getNewTrackers } from "@/libs/quest";
import {
  trackerGoalValue as goalValue,
  trackerQuest as makeQuest,
  trackerUser as makeUser,
} from "../../setup/quest";

const itemsCraftedObjective = (id: string, value = 5) => ({
  id,
  task: "items_crafted" as const,
  value,
  description: "",
  successDescription: "",
});

const craftSpecificObjective = (id: string, ids: string[], value = 5) => ({
  id,
  task: "craft_specific_item" as const,
  value,
  craftItemIds: ids,
  description: "",
  successDescription: "",
});

const craftEmit = (quantity: number, itemId: string) =>
  getCraftTrackerTasks(10, quantity, itemId);

describe("craft mutation tracker emits", () => {
  it("items_crafted counter increments by the crafted quantity", () => {
    const quest = makeQuest("q-craft", [itemsCraftedObjective("o-count", 5)]);
    const result = getNewTrackers(makeUser([quest]), craftEmit(3, "itemA"));
    expect(goalValue(result, "q-craft", "o-count")).toBe(3);
  });

  it("craft_specific_item increments only when the crafted itemId is listed", () => {
    const quest = makeQuest("q-spec", [
      craftSpecificObjective("o-match", ["itemA", "itemB"], 5),
      craftSpecificObjective("o-other", ["itemZ"], 5),
    ]);
    const result = getNewTrackers(makeUser([quest]), craftEmit(3, "itemA"));
    // Matching id-list: credited by the crafted quantity (no double-count via the
    // generic value path, which is guarded off for content-gated tasks).
    expect(goalValue(result, "q-spec", "o-match")).toBe(3);
    // Disjoint id-list: not credited.
    expect(goalValue(result, "q-spec", "o-other")).toBe(0);
  });
});
