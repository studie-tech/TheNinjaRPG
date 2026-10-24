import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { CRAFTING_TIMES_MINS } from "@/drizzle/constants";
import { craftingRequirement, farmCollectionLog, farmPlot, item, quest, questHistory, userCookingJob, userData, userItem, userQueue, userVote, village } from "@/drizzle/schema";
import { farmingRouter } from "@/server/api/routers/farming";
import { occupationRouter } from "@/server/api/routers/occupation";
import { settleCraftingQueue } from "@/server/utils/userQueue";
import { MEAL_ITEM_DEFAULTS } from "@/validators/cooking";
import { insertItems, insertUsers, insertUserItems } from "../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

const userId = "bonus-user";

describeWithDatabase("Territory War activity bonus consumers", () => {
  beforeEach(async () => {
    await resetTables(craftingRequirement, farmCollectionLog, farmPlot, userCookingJob, userItem, userQueue, userVote, questHistory, quest, item, userData, village);
    const db = await getTestDatabase();
    await db.insert(village).values({ id: "bonus-home", name: "Bonus Home", sector: 1, kageId: userId, territoryWarBoostUntil: new Date(Date.now() + 3500000) });
    await insertUsers([{ userId, username: "bonus-user", gender: "Male", status: "AWAKE", occupation: "CRAFTING", rank: "JONIN", level: 50, villageId: "bonus-home", sector: 1, federalStatus: "GOLD", regenAt: new Date(), updatedAt: new Date() }]);
    await db.insert(userVote).values({ id: "bonus-vote", userId, secret: "bonusvote", lastVoteAt: new Date() });
    await insertItems([
      { id: "material", canStack: true, stackSize: 100 },
      { id: "crafted", canBeCrafted: true, craftingExperience: 1000, rarity: "COMMON", itemType: "WEAPON" },
      { id: "meal", ...MEAL_ITEM_DEFAULTS, itemType: "MEAL", canBeCrafted: true, canStack: true, stackSize: 100, cookingTimeSeconds: 100, cookingOutputQuantity: 1, cookingExperience: 1000 },
      { id: "seed", isFarmSeed: true, farmYieldItemId: "crop", farmGrowTimeSeconds: 60, farmMinLevel: 1 },
      { id: "crop", farmHarvestExperience: 1000, farmSellValue: 10 },
    ]);
    await db.insert(craftingRequirement).values(["crafted", "meal"].map(id => ({ id: `recipe-${id}`, craftItemId: id, requirementItemId: "material", quantity: 1 })));
    await insertUserItems([{ id: "materials", userId, itemId: "material", quantity: 20 }]);
  });

  it("awards boosted crafting XP and a shorter direct craft", async () => {
    const db = await getTestDatabase();
    const startedAt = Date.now();
    const result = await (await callerFor(occupationRouter, userId)).craftItem({ itemId: "crafted", quantity: 1 });
    expect(result.success, result.message).toBe(true);
    const user = (await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))!;
    expect(user.craftingExperience).toBe(1150);
    const output = (await db.query.userItem.findFirst({ where: eq(userItem.itemId, "crafted") }))!;
    const expected = CRAFTING_TIMES_MINS.NOVICE.COMMON * 60000 * 0.85;
    expect(output.craftingFinishedAt!.getTime() - startedAt).toBeGreaterThanOrEqual(expected);
    expect(output.craftingFinishedAt!.getTime() - startedAt).toBeLessThan(expected + 5000);
  });

  it("stores boosted cooking XP and shortens both direct and queued cooking at the actual start", async () => {
    const db = await getTestDatabase();
    const api = await callerFor(occupationRouter, userId);
    const before = Date.now();
    expect((await api.craftItem({ itemId: "meal", quantity: 1 })).success).toBe(true);
    let jobs = await db.query.userCookingJob.findMany();
    expect(jobs[0]!.experience).toBe(1150);
    expect(jobs[0]!.finishesAt.getTime() - before).toBeGreaterThanOrEqual(85000);
    expect(jobs[0]!.finishesAt.getTime() - before).toBeLessThan(90000);
    expect((await api.craftItem({ itemId: "meal", quantity: 1 })).success).toBe(true);
    const firstJobId = jobs[0]!.id;
    const queue = (await db.query.userQueue.findFirst())!;
    expect(queue.durationSeconds).toBe(100);
    const startsAt = new Date(Date.now() - 60000);
    await db.update(userItem).set({ craftingFinishedAt: startsAt }).where(eq(userItem.itemId, "meal"));
    await db.update(userQueue).set({ startsAt, finishesAt: new Date(startsAt.getTime() + 100000) }).where(eq(userQueue.id, queue.id));
    await settleCraftingQueue(db, userId);
    jobs = await db.query.userCookingJob.findMany();
    const queued = jobs.find(job => job.id !== firstJobId)!;
    expect(queued.experience).toBe(1150);
    expect(queued.finishesAt.getTime()).toBe(startsAt.getTime() + 85000);
  });

  it("grants the farming bonus through the real harvest endpoint", async () => {
    const db = await getTestDatabase();
    await db.insert(farmPlot).values({ id: "plot", userId, slotIndex: 0, seedItemId: "seed", plantedAt: new Date(Date.now() - 120000), finishAt: new Date(Date.now() - 60000) });
    const result = await (await callerFor(farmingRouter, userId)).harvestPlot({ plotId: "plot" });
    expect(result.success, result.message).toBe(true);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))?.farmingExperience).toBe(1150);
  });
});
