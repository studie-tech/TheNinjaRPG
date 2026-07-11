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

describe("findActionableBoundObjective — consecutive-objective ordering", () => {
  // A `consecutiveObjectives` quest: the caller marks objectives that are not yet reachable in the
  // tracker chain with `available: false`. c1 is done, c2 is the current step, c3 is downstream.
  const consecutive = [
    {
      questId: "qc",
      objectives: [
        { id: "c1", task: "dialog", overworldPlacementId: "p1", done: true, available: true },
        { id: "c2", task: "dialog", overworldPlacementId: "p2", done: false, available: true },
        {
          id: "c3",
          task: "deliver_item",
          overworldPlacementId: "p3",
          deliverItemIds: ["i1"],
          done: false,
          available: false,
        },
      ],
    },
  ];

  it("skips an out-of-sequence objective bound here but not yet reachable (available: false)", () => {
    // Player walks straight to p3 holding the item — but c3 isn't reachable yet, so no delivery/
    // battle/modal should fire (getNewTrackers would refuse to credit it regardless).
    const r = findActionableBoundObjective({
      activeQuests: consecutive,
      ownedItemIds: ["i1"],
      placementId: "p3",
    });
    expect(r).toBeNull();
  });

  it("matches the currently-reachable objective (available: true)", () => {
    const r = findActionableBoundObjective({
      activeQuests: consecutive,
      ownedItemIds: [],
      placementId: "p2",
    });
    expect(r?.objective.id).toBe("c2");
  });

  it("treats a missing available flag as actionable (non-consecutive quests unchanged)", () => {
    // The skip is `available === false`, so undefined must count as available.
    const r = findActionableBoundObjective({
      activeQuests: quests,
      ownedItemIds: [],
      placementId: "p1",
    });
    expect(r?.objective.id).toBe("o1");
  });
});
