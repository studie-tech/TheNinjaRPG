import { describe, expect, it } from "bun:test";
import {
  getConsumedRaidBuffs,
  getEquippedInventory,
  getInventoryEquipmentChanges,
  getInventoryQuantities,
  getInventoryQuantityChanges,
  getSoldInventory,
  getBulkSellUserUpdate,
  getBulkSoldInventory,
  getHomeStorageMovedInventory,
} from "@/deltas/item";
import { getEquippedJutsus } from "@/deltas/jutsu";

const rows = [
  { id: "one", equipped: "NONE" as const, variants: ["red"] },
  { id: "two", equipped: "HEAD" as const, variants: ["blue"] },
];

describe("inventory reconciliation", () => {
  it("applies the committed swap while preserving variant data", () => {
    const changes = getInventoryEquipmentChanges(rows, [
      { id: "one", equipped: "HEAD" },
      { id: "two", equipped: "NONE" },
    ]);
    const updated = getEquippedInventory(rows, changes);
    expect(updated?.map((row) => row.equipped)).toEqual(["HEAD", "NONE"]);
    expect(updated?.[0]?.variants).toBe(rows[0]!.variants);
    expect(rows[0]?.equipped).toBe("NONE");
    expect(getEquippedInventory(rows.slice(1), changes)).toBeUndefined();
    expect(
      getEquippedInventory(rows, [{ ...changes[0]!, beforeEquipped: "HEAD" }]),
    ).toBeUndefined();
    expect(getEquippedInventory(rows, undefined)).toBeUndefined();
  });

  it("removes only the confirmed sold instance", () => {
    expect(getSoldInventory(rows, "one")).toEqual([rows[1]!]);
    expect(getSoldInventory(rows, "missing")).toBeUndefined();
  });

  it("removes every stack a bulk sell confirmed and keeps the rest", () => {
    const three = [...rows, { id: "three", equipped: "NONE" as const, variants: [] }];
    expect(getBulkSoldInventory(three, ["one", "three"])).toEqual([rows[1]!]);
  });

  it("asks for reconciliation when a bulk-sold stack is not loaded", () => {
    expect(getBulkSoldInventory(rows, ["one", "missing"])).toBeUndefined();
  });

  it("moves confirmed stacks into home storage and keeps their row data", () => {
    const carried = rows.map((row) => ({ ...row, storedAtHome: false }));
    const moved = getHomeStorageMovedInventory(carried, ["one"], true);
    expect(moved?.map((row) => [row.id, row.storedAtHome, row.variants])).toEqual([
      ["one", true, ["red"]],
      ["two", false, ["blue"]],
    ]);
  });

  it("asks for reconciliation when a moved stack is not loaded", () => {
    const carried = rows.map((row) => ({ ...row, storedAtHome: false }));
    expect(getHomeStorageMovedInventory(carried, ["missing"], true)).toBeUndefined();
  });

  it("credits a bulk sell's summed ryo", () => {
    expect(getBulkSellUserUpdate(1_250)).toEqual({ userDelta: { money: 1_250 } });
  });
});

it("patches jutsu equipment but refetches membership-sensitive filtered unequips", () => {
  const jutsus = [
    { id: "one", jutsuId: "jutsu", equipped: true },
    { id: "two", jutsuId: "other", equipped: false },
  ];
  expect(
    getEquippedJutsus(
      jutsus,
      "one",
      { equipped: false, jutsuId: "jutsu" },
      { includeEquipped: true },
    )?.[0]?.equipped,
  ).toBe(false);
  expect(
    getEquippedJutsus(
      jutsus,
      "one",
      { equipped: false, jutsuId: "jutsu" },
      { includeEquipped: true, name: "search" },
    ),
  ).toBeUndefined();
  expect(
    getEquippedJutsus(
      jutsus,
      "one",
      { equipped: true, jutsuId: "jutsu" },
      { includeEquipped: true, name: "search" },
    )?.[0]?.equipped,
  ).toBe(true);
  expect(
    getEquippedJutsus(jutsus, "missing", { equipped: true, jutsuId: "jutsu" }, {}),
  ).toBeUndefined();
  expect(getEquippedJutsus(jutsus, "one", undefined, {})).toBeUndefined();
  expect(
    getEquippedJutsus(jutsus, "one", { equipped: true, jutsuId: "evolved" }, {}),
  ).toBeUndefined();
});

it("patches confirmed consumption and merges without losing variant or keeper metadata", () => {
  const before = [
    { id: "one", itemId: "herb", quantity: 2, variants: ["red"], level: 15 },
    { id: "two", itemId: "herb", quantity: 3, variants: ["blue"], level: 1 },
  ];
  const stamp = new Date("2026-11-02T12:00:00Z");
  const changes = getInventoryQuantityChanges(
    before,
    [
      { id: "one", quantity: 5 },
      { id: "two", quantity: 0 },
    ],
    stamp,
  );
  expect<unknown>(getInventoryQuantities(before, changes)).toEqual([
    { ...before[0], quantity: 5, updatedAt: stamp },
  ]);
  expect(before[0]!.quantity).toBe(2);
  expect(getInventoryQuantities(before, [])).toEqual(before);
  expect(getInventoryQuantities(before, undefined)).toBeUndefined();
  expect(getInventoryQuantities(before, [changes[0]!, changes[0]!])).toBeUndefined();
  expect(
    getInventoryQuantities(before, [{ ...changes[0]!, beforeQuantity: 1 }]),
  ).toBeUndefined();
  expect(
    getInventoryQuantities(before, [{ ...changes[0]!, itemId: "other" }]),
  ).toBeUndefined();
  expect(getInventoryQuantities(before.slice(1), changes)).toBeUndefined();
});

it("extends a loaded meal buff while new identities require their display relations", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const buff = {
    id: "meal",
    itemId: "food",
    questId: "raid",
    expiresAt: new Date(now.getTime() + 60000),
    item: { name: "Meal" },
    quest: { name: "Raid" },
  };
  const result = {
    success: true,
    message: "Ate",
    userPatch: {
      updatedAt: now,
      raidBuffs: [{ ...buff, expiresAt: new Date(now.getTime() + 120000) }],
    },
  };
  const current = { buffs: [buff] } as unknown as Parameters<
    typeof getConsumedRaidBuffs
  >[0];
  const update = result as unknown as Parameters<typeof getConsumedRaidBuffs>[1];
  expect<unknown>(getConsumedRaidBuffs(current, update)?.buffs[0]).toEqual(
    result.userPatch.raidBuffs[0],
  );
  expect(getConsumedRaidBuffs({ buffs: [] }, update)).toBeUndefined();
  expect(getConsumedRaidBuffs(current, { ...update, userPatch: {} })).toBeUndefined();
});
