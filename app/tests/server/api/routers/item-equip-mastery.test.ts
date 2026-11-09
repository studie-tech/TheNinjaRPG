import { describe, expect, it } from "bun:test";
import type { ItemSlot } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import { toggleEquipItem } from "@/server/api/routers/item";
import type { DrizzleClient } from "@/server/db";
import type { ZodAllTags } from "@/validators/combat";

// The equip path only builds its writes; nothing here awaits them.
const client = {
  select: () => ({ from: () => ({ where: () => ({}) }) }),
  update: () => ({
    set: () => ({ where: () => Promise.resolve({ rowsAffected: 1 }) }),
  }),
} as unknown as DrizzleClient;

const ninjutsuBuff = (power: number) =>
  ({
    type: "increasemastery",
    masteryTypes: ["Ninjutsu"],
    calculation: "static",
    power,
    powerPerLevel: 0,
  }) as ZodAllTags;

const chestArmor = (
  id: string,
  over: { equipped?: string; effects?: ZodAllTags[]; required?: number } = {},
) =>
  ({
    id,
    itemId: id,
    userId: "user",
    equipped: over.equipped ?? "NONE",
    quantity: 1,
    durability: 100,
    level: 1,
    storedAtHome: false,
    isInAuction: false,
    craftingFinishedAt: null,
    imbuements: [],
    item: {
      id,
      name: id,
      itemType: "ARMOR",
      slot: "CHEST",
      maxEquips: 1,
      requiredLevel: 1,
      bloodlineId: null,
      maxDurability: 100,
      canBeImbued: false,
      effects: over.effects ?? [],
      requiredNinjutsuMastery: over.required ?? null,
    },
  }) as unknown as UserItemWithRelations;

const equip = (
  useritems: UserItemWithRelations[],
  userItemId: string,
  mastery: number,
  slot?: ItemSlot,
) =>
  toggleEquipItem(
    client,
    userItemId,
    useritems,
    {
      userId: "user",
      level: 50,
      bloodlineId: null,
      isAi: false,
      ninjutsuMastery: mastery,
      genjutsuMastery: 10,
      taijutsuMastery: 10,
      bukijutsuMastery: 10,
      bloodlineMastery: 10,
      sageMastery: 10,
      bloodline: null,
      userSkills: [],
      items: useritems.filter((ui) => ui.equipped !== "NONE"),
    } as unknown as Parameters<typeof toggleEquipItem>[3],
    slot,
  );

describe("toggleEquipItem mastery gate", () => {
  it("refuses gear whose mastery requirement is unmet", async () => {
    const result = await equip([chestArmor("gated", { required: 500 })], "gated", 100);
    expect(result).toMatchObject({
      success: false,
      message: "This item requires 500 Ninjutsu Mastery to equip",
    });
  });

  it("counts buffs from other worn gear", async () => {
    const helm = { ...chestArmor("helm", { effects: [ninjutsuBuff(400)] }) };
    helm.equipped = "HEAD";
    helm.item = { ...helm.item, slot: "HEAD" };
    const result = await equip(
      [helm, chestArmor("gated", { required: 500 })],
      "gated",
      100,
    );
    expect(result).toMatchObject({ success: true, message: "Equipped gated" });
  });

  it("ignores the buff of the gear the swap unequips", async () => {
    const worn = chestArmor("worn", {
      equipped: "CHEST",
      effects: [ninjutsuBuff(400)],
    });
    const result = await equip(
      [worn, chestArmor("gated", { required: 500 })],
      "gated",
      100,
    );
    expect(result).toMatchObject({ success: false });
  });
});

describe("toggleEquipItem slot choice", () => {
  const trinket = (id: string, equipped = "NONE") => {
    const row = chestArmor(id, { equipped });
    row.item = { ...row.item, slot: "ITEM", itemType: "CONSUMABLE", maxEquips: 9 };
    return row;
  };

  it("fills the last free compatible slot", async () => {
    const result = await equip([trinket("a"), trinket("b", "ITEM_6")], "a", 100);
    expect(result).toMatchObject({ success: true });
    const equipped = "newUserItems" in result ? result.newUserItems : [];
    expect(equipped.find((row) => row.id === "a")?.equipped).toBe("ITEM_5");
  });

  it("refuses an item without a real slot type", async () => {
    const row = chestArmor("slotless");
    row.item = { ...row.item, slot: "NONE" };
    const result = await equip([row], "slotless", 100);
    expect(result).toMatchObject({ success: false, message: "No slot found" });
  });

  it("refuses a requested slot the item does not fit", async () => {
    const result = await equip([chestArmor("armor")], "armor", 100, "HEAD");
    expect(result).toMatchObject({
      success: false,
      message: "This item does not fit that slot",
    });
  });

  it("unequips into any requested slot it already occupies", async () => {
    const result = await equip(
      [chestArmor("armor", { equipped: "CHEST" })],
      "armor",
      100,
      "CHEST",
    );
    expect(result).toMatchObject({ success: true, message: "Unequipped armor" });
  });
});
