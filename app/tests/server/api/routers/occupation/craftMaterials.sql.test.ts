import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  craftingRequirement,
  item,
  userData,
  userItem,
  userQueue,
  userVote,
} from "@/drizzle/schema";
import { occupationRouter } from "@/server/api/routers/occupation";
import { profileRouter } from "@/server/api/routers/profile";
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const USER_ID = "material-crafter";

const craft = async (quantity: number) =>
  (await callerFor(occupationRouter, USER_ID)).craftItem({ itemId: "blade", quantity });

const quantities = async () => {
  const rows = await (await getTestDatabase())
    .select()
    .from(userItem)
    .where(eq(userItem.userId, USER_ID));
  return Object.fromEntries(
    rows.filter((row) => row.itemId !== "blade").map((row) => [row.id, row.quantity]),
  );
};

describeWithDatabase("crafting materials", () => {
  beforeEach(async () => {
    await resetTables(
      userQueue,
      craftingRequirement,
      userItem,
      item,
      userVote,
      userData,
    );
    await insertUsers([
      {
        userId: USER_ID,
        username: "Crafter",
        status: "AWAKE",
        occupation: "CRAFTING",
        rank: "JONIN",
        craftingExperience: 1_000_000,
      },
    ]);
    await insertItems([
      {
        id: "blade",
        name: "Blade",
        canBeCrafted: true,
        itemType: "WEAPON",
        slot: "HAND",
      },
      { id: "ore", name: "Ore", stackSize: 100 },
      { id: "coal", name: "Coal", stackSize: 100 },
    ]);
    await (await getTestDatabase()).insert(craftingRequirement).values([
      { id: "req-ore", craftItemId: "blade", requirementItemId: "ore", quantity: 3 },
      { id: "req-coal", craftItemId: "blade", requirementItemId: "coal", quantity: 1 },
    ]);
  });

  it("names the missing material with what the player holds", async () => {
    await insertUserItems([
      { id: "ore-a", userId: USER_ID, itemId: "ore", quantity: 2 },
      { id: "ore-b", userId: USER_ID, itemId: "ore", quantity: 3 },
      { id: "coal", userId: USER_ID, itemId: "coal", quantity: 2 },
    ]);
    expect(await craft(2)).toEqual({
      success: false,
      message: "You need 6 Ore (you have 5)",
    });
    expect(await quantities()).toEqual({ "ore-a": 2, "ore-b": 3, coal: 2 });
  });

  it("does not count stacks in auction or still being crafted", async () => {
    await insertUserItems([
      {
        id: "ore-listed",
        userId: USER_ID,
        itemId: "ore",
        quantity: 9,
        isInAuction: true,
      },
      {
        id: "ore-brewing",
        userId: USER_ID,
        itemId: "ore",
        quantity: 9,
        craftingFinishedAt: new Date(Date.now() + 60_000),
      },
      { id: "coal", userId: USER_ID, itemId: "coal", quantity: 5 },
    ]);
    expect(await craft(1)).toEqual({
      success: false,
      message: "You need 3 Ore (you have 0)",
    });
  });

  it("checks every requirement before taking any material", async () => {
    await insertUserItems([
      { id: "ore", userId: USER_ID, itemId: "ore", quantity: 10 },
    ]);
    expect(await craft(1)).toEqual({
      success: false,
      message: "You need 1 Coal (you have 0)",
    });
    expect(await quantities()).toEqual({ ore: 10 });
  });

  it("takes the smallest stacks first across requirements", async () => {
    await insertUserItems([
      { id: "ore-large", userId: USER_ID, itemId: "ore", quantity: 8 },
      { id: "ore-small", userId: USER_ID, itemId: "ore", quantity: 4 },
      { id: "coal", userId: USER_ID, itemId: "coal", quantity: 2 },
    ]);
    expect((await craft(2)).success).toBe(true);
    expect(await quantities()).toEqual({ "ore-large": 6 });
  });
  it("snapshots multi-item output and batch experience for immediate and queued crafts", async () => {
    const db = await getTestDatabase();
    await db
      .update(item)
      .set({
        craftingOutputQuantity: 3,
        craftingExperience: 5,
        canStack: false,
        stackSize: 10,
      })
      .where(eq(item.id, "blade"));
    await insertUserItems([
      { id: "ore", userId: USER_ID, itemId: "ore", quantity: 20 },
      { id: "coal", userId: USER_ID, itemId: "coal", quantity: 10 },
    ]);
    expect((await craft(1)).success).toBe(true);
    const firstUser = await db.query.userData.findFirst({
      where: eq(userData.userId, USER_ID),
    });
    const firstOutputs = await db
      .select()
      .from(userItem)
      .where(eq(userItem.itemId, "blade"));
    expect(firstOutputs.map((row) => row.quantity)).toEqual([1, 1, 1]);
    expect((await craft(2)).success).toBe(true);
    const queued = await db.query.userQueue.findFirst({
      where: eq(userQueue.userId, USER_ID),
    });
    expect(queued).toMatchObject({ quantity: 6, craftBatches: 2 });
    await db
      .update(item)
      .set({ craftingOutputQuantity: 1 })
      .where(eq(item.id, "blade"));
    const dueStart = new Date(Date.now() - 60_000);
    await db
      .update(userItem)
      .set({ craftingFinishedAt: dueStart })
      .where(eq(userItem.itemId, "blade"));
    await db
      .update(userQueue)
      .set({
        startsAt: dueStart,
        finishesAt: new Date(dueStart.getTime() + queued!.durationSeconds! * 1000),
      })
      .where(eq(userQueue.id, queued!.id));
    await (await callerFor(profileRouter, USER_ID)).getUser();
    const outputs = await db
      .select()
      .from(userItem)
      .where(eq(userItem.itemId, "blade"));
    expect(outputs).toHaveLength(9);
    expect(outputs.every((row) => row.quantity === 1)).toBe(true);
    const finalUser = await db.query.userData.findFirst({
      where: eq(userData.userId, USER_ID),
    });
    expect(finalUser!.craftingExperience - firstUser!.craftingExperience).toBe(
      2 * (firstUser!.craftingExperience - 1_000_000),
    );
    expect(await quantities()).toEqual({ ore: 11, coal: 7 });
  });
});
