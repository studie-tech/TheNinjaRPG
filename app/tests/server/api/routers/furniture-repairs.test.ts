import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { item, userData, userItem } from "@/drizzle/schema";
import { calcItemRepairCost } from "@/libs/item";
import { itemRouter } from "@/server/api/routers/item";
import { RepairTag } from "@/validators/combat";
import { FURNITURE_ITEM_DEFAULTS } from "@/validators/itemFurniture";
import { insertItems, insertUserItems, insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const userId = "furniture-repair-owner";
const money = 10_000_000;

describeWithDatabase("furniture repair exclusions", () => {
  beforeEach(async () => {
    await resetTables(userItem, item, userData);
    await insertUsers([
      { userId, username: userId, status: "AWAKE", occupation: "CRAFTING", money },
    ]);
    await insertItems([
      {
        ...FURNITURE_ITEM_DEFAULTS,
        id: "chair",
        name: "Chair",
        itemType: "FURNITURE",
        maxDurability: 100,
        effects: [RepairTag.parse({ power: 100 })],
        destroyOnUse: true,
      },
      { id: "armor", itemType: "ARMOR", maxDurability: 100, cost: 1_000 },
      {
        id: "kit",
        itemType: "CONSUMABLE",
        effects: [RepairTag.parse({ power: 100 })],
        destroyOnUse: true,
      },
    ]);
    await insertUserItems([
      {
        id: "owned-chair",
        userId,
        itemId: "chair",
        durability: 10,
        storedAtHome: false,
      },
      {
        id: "owned-armor",
        userId,
        itemId: "armor",
        durability: 10,
        storedAtHome: false,
      },
      { id: "owned-kit", userId, itemId: "kit", quantity: 2, storedAtHome: false },
    ]);
  });

  const snapshot = async () => {
    const database = await getTestDatabase();
    const [owners, inventory] = await Promise.all([
      database
        .select({ money: userData.money })
        .from(userData)
        .where(eq(userData.userId, userId)),
      database
        .select()
        .from(userItem)
        .where(eq(userItem.userId, userId))
        .orderBy(userItem.id),
    ]);
    return { money: owners[0]!.money, inventory };
  };

  it("rejects individual ryo repair of furniture without charging or changing durability", async () => {
    const before = await snapshot();
    const api = await callerFor(itemRouter, userId);
    expect(await api.repair({ userItemId: "owned-chair" })).toMatchObject({
      success: false,
      message: expect.stringContaining("cannot be repaired"),
    });
    expect(await snapshot()).toEqual(before);
  });

  it("rejects furniture as a repair target without consuming a valid kit", async () => {
    const before = await snapshot();
    const api = await callerFor(itemRouter, userId);
    expect(
      await api.useRepairItem({
        repairItemId: "owned-kit",
        targetItemId: "owned-chair",
      }),
    ).toMatchObject({
      success: false,
      message: expect.stringContaining("cannot be repaired"),
    });
    expect(await snapshot()).toEqual(before);
  });

  it("rejects furniture with a repair effect as a kit without deleting it or repairing armor", async () => {
    const before = await snapshot();
    const api = await callerFor(itemRouter, userId);
    expect(
      await api.useRepairItem({
        repairItemId: "owned-chair",
        targetItemId: "owned-armor",
      }),
    ).toMatchObject({
      success: false,
      message: expect.stringContaining("cannot be used as a repair kit"),
    });
    expect(await snapshot()).toEqual(before);
  });

  it("still charges for an individual armor repair", async () => {
    const database = await getTestDatabase();
    const armor = await database.query.userItem.findFirst({
      where: eq(userItem.id, "owned-armor"),
      with: { item: true },
    });
    const repairCost = calcItemRepairCost(armor!);
    const api = await callerFor(itemRouter, userId);
    expect((await api.repair({ userItemId: "owned-armor" })).success).toBe(true);
    const after = await snapshot();
    expect(after.money).toBe(money - repairCost);
    expect(after.inventory.find(({ id }) => id === "owned-armor")?.durability).toBe(
      100,
    );
    expect(after.inventory.find(({ id }) => id === "owned-chair")?.durability).toBe(10);
  });

  it("still consumes one valid repair kit to repair armor", async () => {
    const api = await callerFor(itemRouter, userId);
    expect(
      (
        await api.useRepairItem({
          repairItemId: "owned-kit",
          targetItemId: "owned-armor",
        })
      ).success,
    ).toBe(true);
    const after = await snapshot();
    expect(after.money).toBe(money);
    expect(after.inventory.find(({ id }) => id === "owned-armor")?.durability).toBe(
      100,
    );
    expect(after.inventory.find(({ id }) => id === "owned-kit")?.quantity).toBe(1);
    expect(after.inventory.find(({ id }) => id === "owned-chair")?.durability).toBe(10);
  });

  it("reports the repaired durability for the inventory views", async () => {
    const api = await callerFor(itemRouter, userId);
    expect(await api.repair({ userItemId: "owned-armor" })).toMatchObject({
      success: true,
      durabilityChanges: [{ id: "owned-armor", beforeDurability: 10, durability: 100 }],
    });
  });

  it.each([
    ["the item changed", { durability: 20 }, "Could not repair item"],
    ["the balance was spent", { money: 0 }, "Insufficient funds"],
  ] as const)(
    "neither charges nor repairs when %s after the read",
    async (_case, change, message) => {
      const database = await getTestDatabase();
      const stale = beforeStatements(
        database,
        userItem,
        [
          () =>
            "money" in change
              ? database.update(userData).set(change).where(eq(userData.userId, userId))
              : database
                  .update(userItem)
                  .set(change)
                  .where(eq(userItem.id, "owned-armor")),
        ],
        { operations: ["execute"] },
      );
      const before = await snapshot();
      const result = await callerForDatabase(itemRouter, userId, stale).repair({
        userItemId: "owned-armor",
      });
      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining(message),
      });
      const after = await snapshot();
      expect(after.money).toBe("money" in change ? 0 : before.money);
      expect(after.inventory.find(({ id }) => id === "owned-armor")?.durability).toBe(
        "durability" in change ? 20 : 10,
      );
    },
  );
});
