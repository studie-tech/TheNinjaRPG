import { describe, it, expect } from "vitest";
import {
  buildMissingLoadouts,
  decideRename,
  findAllowedLoadout,
  resolveSelectableLoadout,
} from "@/libs/loadout";

describe("resolveSelectableLoadout", () => {
  const loadouts = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("resolves a loadout within the allowance", () => {
    expect(resolveSelectableLoadout(loadouts, "b", 3)).toEqual({
      ok: true,
      loadout: { id: "b" },
    });
  });
  it("rejects when loadouts are unavailable", () => {
    expect(resolveSelectableLoadout(loadouts, "a", 0)).toEqual({
      ok: false,
      message: "Loadouts not available",
    });
  });
  it("rejects an out-of-range loadout", () => {
    expect(resolveSelectableLoadout(loadouts, "c", 2)).toEqual({
      ok: false,
      message: "Loadout not found",
    });
  });
});

describe("findAllowedLoadout", () => {
  const loadouts = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("returns a loadout within the allowance", () => {
    expect(findAllowedLoadout(loadouts, "b", 3)).toEqual({ id: "b" });
  });
  it("returns undefined for a loadout beyond the allowance", () => {
    expect(findAllowedLoadout(loadouts, "c", 2)).toBeUndefined();
  });
  it("returns undefined for an unknown id", () => {
    expect(findAllowedLoadout(loadouts, "z", 3)).toBeUndefined();
  });
});

describe("decideRename", () => {
  const loadouts = [
    { id: "a", name: "One" },
    { id: "b", name: "Two" },
    { id: "c", name: "Three" },
  ];

  it("renames a loadout that is within the allowance", () => {
    expect(decideRename(loadouts, 3, { id: "b", name: "New" })).toEqual({
      ok: true,
      changed: true,
      name: "New",
    });
  });

  it("rejects a loadout beyond the current allowance (out-of-range access)", () => {
    // maxLoadouts 2 => index of "c" is 2, which is >= 2 and therefore hidden.
    const d = decideRename(loadouts, 2, { id: "c", name: "New" });
    expect(d.ok).toBe(false);
  });

  it("rejects an unknown id", () => {
    expect(decideRename(loadouts, 3, { id: "z", name: "New" }).ok).toBe(false);
  });

  it("is a no-op when the name is unchanged", () => {
    const d = decideRename(loadouts, 3, { id: "b", name: "Two" });
    expect(d).toMatchObject({ ok: true, changed: false });
  });
});

describe("buildMissingLoadouts", () => {
  const base = new Date("2026-06-17T00:00:00Z");

  it("returns nothing when already at the allowance", () => {
    expect(buildMissingLoadouts("u1", "item", 3, 3, { itemData: [] }, base)).toEqual([]);
  });

  it("creates deterministic ids only for the missing indices", () => {
    const rows = buildMissingLoadouts("u1", "item", 1, 3, { itemData: [] }, base);
    expect(rows.map((r) => r.id)).toEqual(["u1-item-1", "u1-item-2"]);
    expect(rows.every((r) => r.userId === "u1" && r.name === "")).toBe(true);
  });

  it("assigns strictly increasing createdAt so asc ordering stays index-stable", () => {
    const rows = buildMissingLoadouts("u1", "jutsu", 0, 3, { jutsuIds: [] }, base);
    const t = rows.map((r) => r.createdAt.getTime());
    expect(t).toEqual([...t].sort((a, b) => a - b));
    expect(new Set(t).size).toBe(t.length);
  });

  it("spreads the empty content payload onto each row", () => {
    const rows = buildMissingLoadouts("u1", "item", 0, 1, { itemData: [] }, base);
    expect(rows[0]).toMatchObject({ id: "u1-item-0", itemData: [] });
  });
});
