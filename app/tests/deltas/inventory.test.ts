import { describe, expect, it } from "bun:test";
import {
  getAutoEquippedChanges,
  getBulkSoldInventory,
  getClearedLoadoutId,
  getConsumedRaidBuffs,
  getEquippedInventory,
  getHomeStorageMergedInventory,
  getHomeStorageMovedInventory,
  getImbuementRemovedInventory,
  getInventoryDurabilities,
  getInventoryEquipmentChanges,
  getInventoryQuantities,
  getInventoryQuantityChanges,
  getSaleUserUpdate,
  getSelectedVariantInventory,
  getSelectedVariantUserPatch,
  getSoldInventory,
  getUnequippedEquipmentChanges,
} from "@/deltas/item";
import {
  getEquippedJutsus,
  getForgottenJutsuProfilePatch,
  getForgottenJutsus,
  getInvalidatedJutsuUserUpdate,
  getTransferredJutsus,
  getUnequippedJutsus,
} from "@/deltas/jutsu";
import type { ItemVariant, UserItem } from "@/drizzle/schema";

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

  it("moves a stack home and joins it to the stack stored there", () => {
    const stacks = [
      { id: "carried", itemId: "herb", quantity: 4, storedAtHome: false },
      { id: "stored", itemId: "herb", quantity: 5, storedAtHome: true },
    ];
    expect(
      getHomeStorageMergedInventory(stacks, ["carried"], true, [
        { id: "stored", itemId: "herb", beforeQuantity: 5, quantity: 9 },
        { id: "carried", itemId: "herb", beforeQuantity: 4, quantity: 0 },
      ]),
    ).toEqual([{ id: "stored", itemId: "herb", quantity: 9, storedAtHome: true }]);
    expect(getHomeStorageMergedInventory(stacks, ["carried"], true, [])).toEqual([
      { ...stacks[0]!, storedAtHome: true },
      stacks[1]!,
    ]);
    expect(getHomeStorageMergedInventory(stacks, ["carried"], true, undefined)).toBe(
      undefined,
    );
    expect(getHomeStorageMergedInventory(stacks, ["missing"], true, [])).toBe(
      undefined,
    );
  });

  it("describes the slots unequip-all and auto-equip saved", () => {
    expect(getUnequippedEquipmentChanges(rows)).toEqual([
      { id: "one", equipped: "NONE", beforeEquipped: "NONE" },
      { id: "two", equipped: "NONE", beforeEquipped: "HEAD" },
    ]);
    const filled = getAutoEquippedChanges([{ userItemId: "one", slot: "FEET" }]);
    expect(
      getEquippedInventory(rows, filled)?.map((row): string => row.equipped),
    ).toEqual(["FEET", "HEAD"]);
  });

  it("names the cleared loadout, confirms an untouched one and withholds an unconfirmed one", () => {
    expect(getClearedLoadoutId({ id: "main" }, { rowsAffected: 1 })).toBe("main");
    expect(getClearedLoadoutId(undefined, undefined)).toBeNull();
    expect(getClearedLoadoutId({ id: "main" }, { rowsAffected: 0 })).toBeUndefined();
  });

  it("points a stack at its saved variant in every view and the worn gear", () => {
    const variant = { id: "gold" } as ItemVariant;
    type Lean = {
      id: string;
      activeVariantId: string | null;
      activeVariant: ItemVariant | null;
    };
    const lean: Lean[] = [
      { id: "one", activeVariantId: null, activeVariant: null },
      { id: "two", activeVariantId: null, activeVariant: null },
    ];
    const withVariants: {
      id: string;
      activeVariantId: string | null;
      variants: string[];
    }[] = [{ id: "one", activeVariantId: "old", variants: ["gold"] }];
    expect(getSelectedVariantInventory(lean, "one", variant)?.[0]).toEqual({
      id: "one",
      activeVariantId: "gold",
      activeVariant: variant,
    });
    expect(getSelectedVariantInventory(withVariants, "one", null)).toEqual([
      { id: "one", activeVariantId: null, variants: ["gold"] },
    ]);
    expect(getSelectedVariantInventory(lean, "missing", variant)).toBeUndefined();
    expect(getSelectedVariantUserPatch(lean, "two", variant, true)).toEqual({
      items: [lean[0]!, { id: "two", activeVariantId: "gold", activeVariant: variant }],
    });
    expect(getSelectedVariantUserPatch(lean, "carried", variant, false)).toEqual({});
    expect(getSelectedVariantUserPatch(lean, "carried", variant, true)).toBeUndefined();
    expect(getSelectedVariantUserPatch(lean, "two", variant, false)).toBeUndefined();
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

  it("requires matching ownership and known profile equipment before projecting a forgotten jutsu", () => {
    const user = { jutsus: [{ jutsuId: "a" }] };
    expect(getForgottenJutsuProfilePatch(user, undefined, "one")).toBeUndefined();
    expect(getForgottenJutsuProfilePatch(user, jutsus[0], "two")).toBeUndefined();
    expect(getForgottenJutsuProfilePatch({}, jutsus[0], "one")).toBeUndefined();
    expect(getForgottenJutsuProfilePatch(user, jutsus[1], "two")).toEqual(user);
  });

  it("projects only equipment retained after confirmed requirement invalidations", () => {
    const equipped = [
      ...jutsus,
      { id: "three", jutsuId: "c", equipped: true, level: 1 },
    ];
    expect(getInvalidatedJutsuUserUpdate(equipped, ["a"])).toEqual({
      userPatch: { jutsus: [{ jutsuId: "c" }] },
    });
    expect(getInvalidatedJutsuUserUpdate(equipped, ["a", "c"])).toEqual({
      userPatch: { jutsus: [] },
    });
    expect(equipped[0]?.equipped).toBe(true);
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
