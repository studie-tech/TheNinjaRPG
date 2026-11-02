import { expect, it } from "bun:test";
import { getEquippedJutsuLoadouts, getOrderedJutsuLoadouts } from "@/deltas/loadout";
import { getEquippedJutsuProfilePatch } from "@/deltas/jutsu";

it("applies confirmed equip membership against its server baseline without replacing other loadouts", () => {
  const rows = [{ id: "one", name: "Main", jutsuIds: ["a"] }, { id: "two", name: "Spare", jutsuIds: ["c"] }];
  const change = { equipped: true, jutsuId: "b", loadout: { id: "one", jutsuIds: ["a"] } };
  expect(getEquippedJutsuLoadouts(rows, change)).toEqual([{ ...rows[0]!, jutsuIds: ["a", "b"] }, rows[1]!]);
  expect(getEquippedJutsuLoadouts(rows, { ...change, equipped: false, jutsuId: "a" })?.[0]?.jutsuIds).toEqual([]);
  expect(getEquippedJutsuLoadouts(rows, { ...change, loadout: { id: "one", jutsuIds: ["newer"] } })).toBeUndefined();
  expect(getEquippedJutsuLoadouts(rows, { ...change, loadout: undefined })).toBeUndefined();
  expect(getEquippedJutsuLoadouts(rows, undefined)).toBeUndefined();
  expect(rows[0]?.jutsuIds).toEqual(["a"]);
});

it("reconciles profile equipment only for the confirmed active loadout and membership baseline", () => {
  const user = { jutsuLoadout: "one", loadout: { jutsuIds: ["a"] } } as Parameters<typeof getEquippedJutsuProfilePatch>[0];
  const change = { equipped: true, jutsuId: "b", loadout: { id: "one", jutsuIds: ["a"] } };
  expect(getEquippedJutsuProfilePatch(user, change)).toEqual({ loadout: { jutsuIds: ["a", "b"] } });
  expect(getEquippedJutsuProfilePatch({ ...user, jutsuLoadout: "other" }, change)).toBeUndefined();
  expect(getEquippedJutsuProfilePatch(user, { ...change, loadout: { id: "one", jutsuIds: [] } })).toBeUndefined();
  expect(getEquippedJutsuProfilePatch(user, { ...change, loadout: undefined })).toBeUndefined();
});

it("keeps the saved order bound to its requested loadout and recovers missing destinations", () => {
  const rows = [{ id: "one", name: "Main", jutsuIds: ["a", "b"] }];
  expect(getOrderedJutsuLoadouts(rows, "one", ["b", "a"])).toEqual([{ ...rows[0]!, jutsuIds: ["b", "a"] }]);
  expect(getOrderedJutsuLoadouts(rows, "missing", [])).toBeUndefined();
  expect(getOrderedJutsuLoadouts(rows, "one", undefined)).toBeUndefined();
});
