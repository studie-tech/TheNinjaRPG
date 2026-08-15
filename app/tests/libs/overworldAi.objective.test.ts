import { describe, expect, it } from "vitest";
import {
  earlierBoundObjectivesComplete,
  findActionableBoundObjective,
  resolveArrivalPromptCta,
} from "@/libs/overworldAi";

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

  it("matches a deliver objective regardless of items when ignoreItemOwnership is set", () => {
    // Client CTA prediction: it holds only equipped items so it can't confirm possession, and
    // predicts "Deliver" from reachability alone (server re-checks the real inventory on click).
    const r = findActionableBoundObjective({
      activeQuests: quests,
      ownedItemIds: [],
      placementId: "p2",
      ignoreItemOwnership: true,
    });
    expect(r?.objective.id).toBe("o2");
  });

  it("returns null when nothing is bound to the placement", () => {
    expect(
      findActionableBoundObjective({ activeQuests: quests, ownedItemIds: [], placementId: "pX" }),
    ).toBeNull();
  });

  it("ignores unsupported task bindings from legacy malformed content", () => {
    expect(
      findActionableBoundObjective({
        activeQuests: [
          {
            questId: "bad",
            objectives: [
              { id: "o1", task: "pvp_kills", overworldPlacementId: "p1" },
            ],
          },
        ],
        ownedItemIds: [],
        placementId: "p1",
      }),
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

describe("earlierBoundObjectivesComplete — bound-objective ordering gate", () => {
  // The gate powers reachability for NON-consecutive quests: a quest that binds multiple objectives
  // to different overworld placements must still be completed in objective order at the tiles.
  it("is true for the first objective (no earlier bound objectives)", () => {
    const objectives = [
      { overworldPlacementId: "p1", done: false },
      { overworldPlacementId: "p2", done: false },
    ];
    expect(earlierBoundObjectivesComplete(objectives, 0)).toBe(true);
  });

  it("blocks a later bound objective while an earlier bound objective is not done", () => {
    // Out-of-sequence case: report back (p2) must not fire while the defeat objective (p1) is undone.
    const objectives = [
      { overworldPlacementId: "p1", done: false },
      { overworldPlacementId: "p2", done: false },
    ];
    expect(earlierBoundObjectivesComplete(objectives, 1)).toBe(false);
  });

  it("allows a later bound objective once the earlier bound objective is done", () => {
    const objectives = [
      { overworldPlacementId: "p1", done: true },
      { overworldPlacementId: "p2", done: false },
    ];
    expect(earlierBoundObjectivesComplete(objectives, 1)).toBe(true);
  });

  it("ignores earlier objectives that are not placement-bound", () => {
    // An earlier non-overworld objective (e.g. a counter task) never gates the overworld tile.
    const objectives = [
      { overworldPlacementId: null, done: false },
      { overworldPlacementId: "p2", done: false },
    ];
    expect(earlierBoundObjectivesComplete(objectives, 1)).toBe(true);
  });

  it("requires every earlier bound objective, not just the immediately preceding one", () => {
    const objectives = [
      { overworldPlacementId: "p1", done: false },
      { overworldPlacementId: null, done: true },
      { overworldPlacementId: "p3", done: false },
    ];
    expect(earlierBoundObjectivesComplete(objectives, 2)).toBe(false);
  });
});

describe("resolveArrivalPromptCta", () => {
  it.each([
    ["dialog", "Talk"],
    ["deliver_item", "Deliver"],
    ["defeat_opponents", "Fight"],
    [null, "Request mission"],
  ])("maps %s to the expected friendly interaction", (task, action) => {
    expect(
      resolveArrivalPromptCta(
        { username: "NPC", npcInteractionType: "FRIENDLY" },
        task,
      ).action,
    ).toBe(action);
  });

  it("always attacks a hostile NPC even if a friendly task is bound", () => {
    expect(
      resolveArrivalPromptCta(
        { username: "Enemy", npcInteractionType: "HOSTILE" },
        "dialog",
      ),
    ).toMatchObject({ action: "Attack", dismiss: "Leave" });
  });
});
