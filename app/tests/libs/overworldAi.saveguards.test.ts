import { describe, expect, it } from "vitest";
import {
  hasFriendlyBindingToPlacement,
  validateFriendlyPlacementBindings,
} from "@/libs/overworldAi";

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

describe("hasFriendlyBindingToPlacement", () => {
  it("is true when a deliver_item objective binds the placement", () => {
    expect(
      hasFriendlyBindingToPlacement(
        [{ task: "deliver_item", overworldPlacementId: "p1" }],
        "p1",
      ),
    ).toBe(true);
  });

  it("is true when a dialog objective binds the placement", () => {
    expect(
      hasFriendlyBindingToPlacement([{ task: "dialog", overworldPlacementId: "p1" }], "p1"),
    ).toBe(true);
  });

  it("is false when only a defeat_opponents objective binds the placement (defeat works on either type)", () => {
    expect(
      hasFriendlyBindingToPlacement(
        [{ task: "defeat_opponents", overworldPlacementId: "p1" }],
        "p1",
      ),
    ).toBe(false);
  });

  it("is false when the friendly objective binds a different placement", () => {
    expect(
      hasFriendlyBindingToPlacement(
        [{ task: "deliver_item", overworldPlacementId: "p2" }],
        "p1",
      ),
    ).toBe(false);
  });

  it("is false for no objectives", () => {
    expect(hasFriendlyBindingToPlacement([], "p1")).toBe(false);
  });
});
