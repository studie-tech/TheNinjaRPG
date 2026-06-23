import { describe, expect, it } from "vitest";
import {
  npcMissionSlotDecision,
  validateFriendlyPlacementBindings,
} from "@/libs/overworldAi";

describe("npcMissionSlotDecision", () => {
  it("returns 'free' when no slot is held", () => {
    expect(npcMissionSlotDecision(null, [])).toBe("free");
    expect(npcMissionSlotDecision(undefined, [{ questId: "q1", endAt: null }])).toBe(
      "free",
    );
  });

  it("returns 'block' when the slot points to a still-active quest", () => {
    expect(npcMissionSlotDecision("q1", [{ questId: "q1", endAt: null }])).toBe("block");
  });

  it("blocks regardless of the active quest's type — the slot is authoritative, not the quest type", () => {
    // An active NPC quest blocks a new grant even when visiting an NPC whose pool is a
    // different type; the old type-based gate missed this (and falsely cleared the slot).
    expect(npcMissionSlotDecision("q1", [{ questId: "q1", endAt: null }])).toBe("block");
  });

  it("returns 'clear-stale' when the slotted quest has completed (endAt set)", () => {
    expect(
      npcMissionSlotDecision("q1", [{ questId: "q1", endAt: new Date() }]),
    ).toBe("clear-stale");
  });

  it("returns 'clear-stale' when the slotted quest is no longer held", () => {
    expect(npcMissionSlotDecision("q1", [{ questId: "q2", endAt: null }])).toBe(
      "clear-stale",
    );
  });
});

describe("validateFriendlyPlacementBindings", () => {
  const placements = new Map([
    ["p1", { interactionType: "FRIENDLY" }],
    ["p2", { interactionType: "HOSTILE" }],
  ]);

  it("accepts a deliver_item bound to a FRIENDLY placement", () => {
    expect(
      validateFriendlyPlacementBindings(
        [{ task: "deliver_item", overworldPlacementId: "p1" }],
        placements,
      ).check,
    ).toBe(true);
  });

  it("rejects a deliver_item bound to a HOSTILE placement", () => {
    expect(
      validateFriendlyPlacementBindings(
        [{ task: "deliver_item", overworldPlacementId: "p2" }],
        placements,
      ).check,
    ).toBe(false);
  });

  it("rejects a dialog bound to a non-existent placement", () => {
    expect(
      validateFriendlyPlacementBindings(
        [{ task: "dialog", overworldPlacementId: "ghost" }],
        placements,
      ).check,
    ).toBe(false);
  });

  it("ignores defeat_opponents bindings (validated via opponent derivation instead)", () => {
    expect(
      validateFriendlyPlacementBindings(
        [{ task: "defeat_opponents", overworldPlacementId: "p2" }],
        placements,
      ).check,
    ).toBe(true);
  });

  it("accepts objectives with no placement binding", () => {
    expect(
      validateFriendlyPlacementBindings([{ task: "deliver_item" }], placements).check,
    ).toBe(true);
  });
});
