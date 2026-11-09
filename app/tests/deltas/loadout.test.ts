import { describe, expect, it } from "bun:test";
import {
  getEquippedJutsuLoadouts,
  getOrderedJutsuLoadouts,
  getLoadoutsWithHotkeys,
} from "@/deltas/loadout";
import { getEquippedJutsuProfilePatch } from "@/deltas/jutsu";

it("applies confirmed equip membership against its server baseline without replacing other loadouts", () => {
  const rows = [
    { id: "one", name: "Main", jutsuIds: ["a"] },
    { id: "two", name: "Spare", jutsuIds: ["c"] },
  ];
  const change = {
    equipped: true,
    jutsuId: "b",
    loadout: { id: "one", jutsuIds: ["a"] },
  };
  expect(getEquippedJutsuLoadouts(rows, change)).toEqual([
    { ...rows[0]!, jutsuIds: ["a", "b"] },
    rows[1]!,
  ]);
  expect(
    getEquippedJutsuLoadouts(rows, { ...change, equipped: false, jutsuId: "a" })?.[0]
      ?.jutsuIds,
  ).toEqual([]);
  expect(
    getEquippedJutsuLoadouts(rows, {
      ...change,
      loadout: { id: "one", jutsuIds: ["newer"] },
    }),
  ).toBeUndefined();
  expect(
    getEquippedJutsuLoadouts(rows, { ...change, loadout: undefined }),
  ).toBeUndefined();
  expect(getEquippedJutsuLoadouts(rows, undefined)).toBeUndefined();
  expect(rows[0]?.jutsuIds).toEqual(["a"]);
});

it("reconciles profile equipment only for the confirmed active loadout and membership baseline", () => {
  const user = { jutsuLoadout: "one", loadout: { jutsuIds: ["a"] } } as Parameters<
    typeof getEquippedJutsuProfilePatch
  >[0];
  const change = {
    equipped: true,
    jutsuId: "b",
    loadout: { id: "one", jutsuIds: ["a"] },
  };
  expect(getEquippedJutsuProfilePatch(user, change)).toEqual({
    loadout: { jutsuIds: ["a", "b"] },
  });
  expect(
    getEquippedJutsuProfilePatch({ ...user, jutsuLoadout: "other" }, change),
  ).toBeUndefined();
  expect(
    getEquippedJutsuProfilePatch(user, {
      ...change,
      loadout: { id: "one", jutsuIds: [] },
    }),
  ).toBeUndefined();
  expect(
    getEquippedJutsuProfilePatch(user, { ...change, loadout: undefined }),
  ).toBeUndefined();
});

it("keeps the saved order bound to its requested loadout and recovers missing destinations", () => {
  const rows = [{ id: "one", name: "Main", jutsuIds: ["a", "b"] }];
  expect(getOrderedJutsuLoadouts(rows, "one", ["b", "a"])).toEqual([
    { ...rows[0]!, jutsuIds: ["b", "a"] },
  ]);
  expect(getOrderedJutsuLoadouts(rows, "missing", [])).toBeUndefined();
  expect(getOrderedJutsuLoadouts(rows, "one", undefined)).toBeUndefined();
});

type Loadout = { id: string; name: string; hotkeys: Record<string, string> };

const rows: Loadout[] = [
  { id: "one", name: "One", hotkeys: { q: "jutsu-a" } },
  { id: "two", name: "Two", hotkeys: {} },
];

describe("loadout hotkeys", () => {
  it("replaces only the saved loadout's keys and keeps other rows", () => {
    const updated = getLoadoutsWithHotkeys(rows, "two", { e: "item-b" });
    expect(updated?.map((row) => row.hotkeys)).toEqual([
      { q: "jutsu-a" },
      { e: "item-b" },
    ]);
    expect(updated?.[0]).toBe(rows[0]!);
    expect(rows[1]?.hotkeys).toEqual({});
  });

  it("patches nothing when the loadout is not loaded", () => {
    expect(getLoadoutsWithHotkeys(rows, "missing", { e: "item-b" })).toBeUndefined();
  });
});
