import { describe, expect, it } from "vitest";
import { findActionableBoundObjective } from "@/libs/overworldAi";

const quests = [
  {
    questId: "qd",
    objectives: [
      { id: "o1", task: "dialog", overworldPlacementId: "p1", done: false },
      { id: "o2", task: "deliver_item", overworldPlacementId: "p2", deliverItemIds: ["i1"], done: false },
    ],
  },
];

describe("findActionableBoundObjective", () => {
  it("matches a dialog objective bound to the placement", () => {
    const r = findActionableBoundObjective({ activeQuests: quests, ownedItemIds: [], placementId: "p1" });
    expect(r?.questId).toBe("qd");
    expect(r?.objective.id).toBe("o1");
  });

  it("does NOT match a deliver objective when the item is missing (not actionable)", () => {
    const r = findActionableBoundObjective({ activeQuests: quests, ownedItemIds: [], placementId: "p2" });
    expect(r).toBeNull();
  });

  it("matches a deliver objective when the item is held", () => {
    const r = findActionableBoundObjective({ activeQuests: quests, ownedItemIds: ["i1"], placementId: "p2" });
    expect(r?.objective.id).toBe("o2");
  });

  it("returns null when nothing is bound to the placement", () => {
    expect(
      findActionableBoundObjective({ activeQuests: quests, ownedItemIds: [], placementId: "pX" }),
    ).toBeNull();
  });
});
