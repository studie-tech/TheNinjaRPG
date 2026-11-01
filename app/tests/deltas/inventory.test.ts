import { describe, expect, it } from "bun:test";
import { getEquippedInventory, getInventoryEquipmentChanges, getSoldInventory } from "@/deltas/item";
import { getEquippedJutsus } from "@/deltas/jutsu";

const rows = [
  { id: "one", equipped: "NONE" as const, variants: ["red"] },
  { id: "two", equipped: "HEAD" as const, variants: ["blue"] },
];

describe("inventory reconciliation", () => {
  it("applies the committed swap while preserving variant data", () => {
    const changes = getInventoryEquipmentChanges(rows, [
      { id: "one", equipped: "HEAD" }, { id: "two", equipped: "NONE" },
    ]);
    const updated = getEquippedInventory(rows, changes);
    expect(updated?.map((row) => row.equipped)).toEqual(["HEAD", "NONE"]);
    expect(updated?.[0]?.variants).toBe(rows[0]!.variants);
    expect(rows[0]?.equipped).toBe("NONE");
    expect(getEquippedInventory(rows.slice(1), changes)).toBeUndefined();
    expect(getEquippedInventory(rows, [{ ...changes[0]!, beforeEquipped: "HEAD" }])).toBeUndefined();
    expect(getEquippedInventory(rows, undefined)).toBeUndefined();
  });

  it("removes only the confirmed sold instance", () => {
    expect(getSoldInventory(rows, "one")).toEqual([rows[1]!]);
    expect(getSoldInventory(rows, "missing")).toBeUndefined();
  });
});

it("patches jutsu equipment but refetches membership-sensitive filtered unequips", () => {
  const jutsus = [{ id: "one", jutsuId: "jutsu", equipped: true }, { id: "two", jutsuId: "other", equipped: false }];
  expect(getEquippedJutsus(jutsus, "one", { equipped: false, jutsuId: "jutsu" }, { includeEquipped: true })?.[0]?.equipped).toBe(false);
  expect(getEquippedJutsus(jutsus, "one", { equipped: false, jutsuId: "jutsu" }, { includeEquipped: true, name: "search" })).toBeUndefined();
  expect(getEquippedJutsus(jutsus, "one", { equipped: true, jutsuId: "jutsu" }, { includeEquipped: true, name: "search" })?.[0]?.equipped).toBe(true);
  expect(getEquippedJutsus(jutsus, "missing", { equipped: true, jutsuId: "jutsu" }, {})).toBeUndefined();
  expect(getEquippedJutsus(jutsus, "one", undefined, {})).toBeUndefined();
  expect(getEquippedJutsus(jutsus, "one", { equipped: true, jutsuId: "evolved" }, {})).toBeUndefined();
});
