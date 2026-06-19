import { describe, expect, it } from "vitest";
import { isBoundPlacementDeleted, isBoundPlacementFrozen } from "@/libs/quest";

const obj = (id?: string) => ({ overworldPlacementId: id } as never);

describe("isBoundPlacementDeleted", () => {
  it("returns true when the bound placement is absent from existing (hard-deleted)", () => {
    expect(isBoundPlacementDeleted(obj("p1"), new Set())).toBe(true);
    expect(isBoundPlacementDeleted(obj("p1"), new Set(["p2"]))).toBe(true);
  });

  it("returns false when the bound placement exists (active or not)", () => {
    expect(isBoundPlacementDeleted(obj("p1"), new Set(["p1"]))).toBe(false);
  });

  it("returns false for unbound objectives", () => {
    expect(isBoundPlacementDeleted(obj(), new Set())).toBe(false);
    expect(isBoundPlacementDeleted({} as never, new Set())).toBe(false);
  });
});

describe("isBoundPlacementFrozen", () => {
  it("returns true when the placement exists but is not active (deactivated)", () => {
    const existing = new Set(["p1"]);
    const active = new Set<string>();
    expect(isBoundPlacementFrozen(obj("p1"), existing, active)).toBe(true);
  });

  it("returns false when the placement is active", () => {
    const existing = new Set(["p1"]);
    const active = new Set(["p1"]);
    expect(isBoundPlacementFrozen(obj("p1"), existing, active)).toBe(false);
  });

  it("returns false when the placement is deleted (not in existing)", () => {
    const existing = new Set<string>();
    const active = new Set<string>();
    expect(isBoundPlacementFrozen(obj("p1"), existing, active)).toBe(false);
  });

  it("returns false for unbound objectives", () => {
    const existing = new Set(["p1"]);
    const active = new Set(["p1"]);
    expect(isBoundPlacementFrozen(obj(), existing, active)).toBe(false);
    expect(isBoundPlacementFrozen({} as never, existing, active)).toBe(false);
  });
});
