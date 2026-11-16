import { describe, expect, it } from "bun:test";
import {
  getBulkSoldInventory,
  getConsumedRaidBuffs,
  getEquippedInventory,
  getHomeStorageMovedInventory,
  getImbuementRemovedInventory,
  getInventoryDurabilities,
  getInventoryEquipmentChanges,
  getInventoryQuantities,
  getInventoryQuantityChanges,
  getSaleUserUpdate,
  getSoldInventory,
} from "@/deltas/item";
import {
  getEquippedJutsus,
  getForgottenJutsus,
  getTransferredJutsus,
  getUnequippedJutsus,
} from "@/deltas/jutsu";
import type { UserItem } from "@/drizzle/schema";

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
    expect(getSaleUserUpdate(1_250)).toEqual({ userDelta: { money: 1_250 } });
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

describe("item mutation projections", () => {
  const stack = {
    id: "stack",
    itemId: "herb",
    quantity: 10,
    durability: 80,
    level: 3,
    equipped: "NONE",
    storedAtHome: true,
    homeX: 4,
    homeY: 5,
    variants: ["red"],
  } as unknown as UserItem & { variants: string[] };
  it("applies repaired durability after the kit's quantity", () => {
    const kit = { ...stack, id: "kit", quantity: 2, durability: 100 };
    const repaired = getInventoryDurabilities(
      getInventoryQuantities(
        [stack, kit],
        getInventoryQuantityChanges([kit], [{ id: "kit", quantity: 1 }]),
      ),
      [{ id: "stack", beforeDurability: 80, durability: 100 }],
    );
    expect(repaired?.map((row) => [row.id, row.quantity, row.durability])).toEqual([
      ["stack", 10, 100],
      ["kit", 1, 100],
    ]);
    expect(
      getInventoryDurabilities(
        [stack],
        [{ id: "stack", beforeDurability: 70, durability: 100 }],
      ),
    ).toBeUndefined();
    expect(getInventoryDurabilities(undefined, [])).toBeUndefined();
  });

  it("drops only the removed imbuement and refetches unloaded relations", () => {
    const imbued = { ...stack, imbuements: [{ id: "keep" }, { id: "gone" }] };
    expect(
      getImbuementRemovedInventory([imbued], {
        userItemId: "stack",
        imbuementId: "gone",
      })?.[0],
    ).toEqual({ ...imbued, imbuements: [{ id: "keep" }] });
    expect(
      getImbuementRemovedInventory([stack], {
        userItemId: "stack",
        imbuementId: "gone",
      }),
    ).toBeUndefined();
  });
});

describe("jutsu mutation projections", () => {
  const jutsus = [
    { id: "one", jutsuId: "a", equipped: true, level: 8 },
    { id: "two", jutsuId: "b", equipped: false, level: 2 },
  ];

  it("removes a forgotten jutsu and refetches a missing one", () => {
    expect(getForgottenJutsus(jutsus, "one")).toEqual([jutsus[1]!]);
    expect(getForgottenJutsus(jutsus, "missing")).toBeUndefined();
  });

  it("clears every equip flag unless the filter admits equipped rows", () => {
    expect(getUnequippedJutsus(jutsus, {})?.map((row) => row.equipped)).toEqual([
      false,
      false,
    ]);
    expect(getUnequippedJutsus(jutsus, { includeEquipped: true })).toBeDefined();
    expect(
      getUnequippedJutsus(jutsus, { includeEquipped: true, name: "search" }),
    ).toBeUndefined();
  });

  it("moves transferred levels between matching baselines", () => {
    const transfer = {
      fromUserJutsuId: "one",
      fromLevel: 8,
      toUserJutsuId: "two",
      toLevel: 2,
      levels: 3,
    };
    expect(getTransferredJutsus(jutsus, transfer)?.map((row) => row.level)).toEqual([
      5, 5,
    ]);
    expect(getTransferredJutsus(jutsus, { ...transfer, toLevel: 3 })).toBeUndefined();
    expect(getTransferredJutsus(jutsus, undefined)).toBeUndefined();
  });
});
