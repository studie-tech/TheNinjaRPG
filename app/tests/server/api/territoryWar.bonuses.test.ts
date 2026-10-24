import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { CRAFTING_TIMES_MINS, FARM_STARTING_PLOTS, FARM_WATER_EXPERIENCE, getUserCaps, MEDNIN_EXP_CAP, MEDNIN_REQUIRED_EXP, STATS_PER_ENERGY, TERRITORY_WAR_BOOST_PERCENT, VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { craftingRequirement, farmCollectionLog, farmPlot, item, quest, questHistory, territoryWar, territoryWarScore, userCookingJob, userData, userItem, userQueue, userVote, village } from "@/drizzle/schema";
import { farmingRouter } from "@/server/api/routers/farming";
import { applyFarmMutationPatch } from "@/libs/farm-state";
import { hospitalRouter } from "@/server/api/routers/hospital";
import { occupationRouter } from "@/server/api/routers/occupation";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { settleCraftingQueue } from "@/server/utils/userQueue";
import { MEAL_ITEM_DEFAULTS } from "@/validators/cooking";
import { insertItems, insertUsers, insertUserItems } from "../../setup/factories";
import { queueEnergy, readEnergyQueue } from "../../setup/queues";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

const userId = "bonus-user";

describeWithDatabase("Territory War activity bonus consumers", () => {
  beforeEach(async () => {
    await resetTables(territoryWarScore, territoryWar, craftingRequirement, farmCollectionLog, farmPlot, userCookingJob, userItem, userQueue, userVote, questHistory, quest, item, userData, village);
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

  it("settles near-cap Energy training equally offline and after a victory refresh", async () => {
    const db = await getTestDatabase();
    const start = new Date(Date.now() - 9 * 60000 - 1000);
    const victory = new Date(start.getTime() + 60000);
    const cap = getUserCaps("JONIN").gens_cap;
    await db.insert(village).values({ id: VILLAGE_SYNDICATE_ID, name: "Syndicate", sector: 100, kageId: userId, territoryWarBoostUntil: new Date(victory.getTime() + 3600000) });
    await db.insert(territoryWar).values({ id: "training-victory", predecessorId: "initial", sector: 100, guardianId: "guardian", startsAt: new Date(start.getTime() - 1000), endsAt: victory, resolvedAt: victory });
    await db.insert(territoryWarScore).values({ warId: "training-victory", competitorId: `village:${VILLAGE_SYNDICATE_ID}`, villageId: VILLAGE_SYNDICATE_ID, name: "Syndicate", points: 400, rewarded: true });
    await insertUsers(["offline", "refreshed"].map(id => ({
      userId: id,
      username: id,
      status: "AWAKE" as const,
      isOutlaw: true,
      rank: "JONIN" as const,
      level: 50,
      villageId: VILLAGE_SYNDICATE_ID,
      sector: 100,
      curEnergy: id === "offline" ? 0 : 10,
      regeneration: 10,
      strength: cap - 100 * STATS_PER_ENERGY,
      regenAt: id === "offline" ? start : victory,
      updatedAt: new Date(),
      joinedVillageAt: new Date(0),
    })));
    await db.insert(userVote).values(["offline", "refreshed"].map(id => ({ id: `vote-${id}`, userId: id, secret: `secret-${id}`, lastVoteAt: new Date() })));
    for (const id of ["offline", "refreshed"]) {
      await queueEnergy(id, [{ stat: "strength", energy: 100 }]);
      const result = await fetchUpdatedUser({ client: db, userId: id, forceRegen: true });
      const saved = (await db.query.userData.findFirst({ where: eq(userData.userId, id) }))!;
      expect(result.user?.strength).toBe(cap);
      expect(saved.strength).toBe(cap);
      expect(saved.curEnergy).toBeCloseTo(90 - 100 / (1 + TERRITORY_WAR_BOOST_PERCENT / 100));
      expect(await readEnergyQueue(id)).toEqual([]);
    }
  });

  it.each([
    [MEDNIN_REQUIRED_EXP.LEGENDARY, 51],
    [MEDNIN_EXP_CAP - 10, 10],
    [MEDNIN_EXP_CAP + 10, 0],
  ])("boosts medical XP from %s while respecting the cap", async (medicalExperience, expectedGain) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ medicalExperience, curHealth: 100, maxHealth: 1000, curChakra: 8000, maxChakra: 8000, curStamina: 100, maxStamina: 100, regeneration: 0 }).where(eq(userData.userId, userId));
    const result = await (await callerFor(hospitalRouter, userId)).userHeal({ userId, healPercentage: 100 });
    expect(result.success, result.message).toBe(true);
    expect(result.expGain).toBe(expectedGain);
    const saved = (await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))!;
    expect(saved.medicalExperience).toBe(Math.min(MEDNIN_EXP_CAP, medicalExperience + expectedGain));
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

  it("uses an older victory window when a queued cook settles after a second victory", async () => {
    const db = await getTestDatabase();
    const earlier = new Date(Date.now() - 6 * 3600000);
    const recent = new Date(Date.now() - 10 * 60000);
    await db.insert(territoryWar).values([earlier, recent].map((resolvedAt, index) => ({ id: `bonus-event-${index}`, predecessorId: index ? "bonus-event-0" : "initial", sector: 100, guardianId: "guardian", startsAt: new Date(resolvedAt.getTime() - 1000), endsAt: resolvedAt, resolvedAt })));
    await db.insert(territoryWarScore).values([0,1].map(index => ({ warId: `bonus-event-${index}`, competitorId: "village:bonus-home", villageId: "bonus-home", name: "Bonus Home", points: 400, rewarded: true })));
    await db.update(village).set({ territoryWarBoostUntil: new Date(recent.getTime() + 3600000) }).where(eq(village.id, "bonus-home"));
    const startsAt = new Date(earlier.getTime() + 60000);
    await db.insert(userQueue).values({ id: "offline-cook", userId, kind: "CRAFT", position: 1, itemId: "meal", quantity: 1, materials: [], durationSeconds: 100, startsAt, finishesAt: new Date(startsAt.getTime() + 100000) });
    await settleCraftingQueue(db, userId);
    const job = (await db.query.userCookingJob.findFirst())!;
    expect(job.experience).toBe(1150);
    expect(job.finishesAt.getTime()).toBe(startsAt.getTime() + 85000);
  });

  it.each([
    ["plantSeed", 40], ["plantAllEmpty", 40],
    ["waterPlot", FARM_WATER_EXPERIENCE], ["waterAll", FARM_WATER_EXPERIENCE],
    ["applyFertilizer", 60], ["fertilizeAll", 60],
    ["harvestPlot", 1000], ["harvestAll", 1000],
    ["plantSeed", 0], ["plantAllEmpty", 0],
  ] as const)("returns and patches the awarded XP for %s with %s base XP", async (action, baseXp) => {
    const db = await getTestDatabase();
    const planting = action === "plantSeed" || action === "plantAllEmpty";
    const harvesting = action === "harvestPlot" || action === "harvestAll";
    const bulk = ["plantAllEmpty", "waterAll", "fertilizeAll", "harvestAll"].includes(action);
    await db.update(item).set({ farmPlantExperience: baseXp }).where(eq(item.id, "seed"));
    await insertItems([{ id: "fertilizer", name: "Fertilizer", isFarmFertilizer: true, farmFertilizerExperience: baseXp, farmTimeReductionSeconds: 60 }]);
    await insertUserItems([{ id: "seed-stack", userId, itemId: "seed", quantity: FARM_STARTING_PLOTS }, { id: "fertilizer-stack", userId, itemId: "fertilizer", quantity: FARM_STARTING_PLOTS }]);
    await db.insert(farmPlot).values(Array.from({ length: FARM_STARTING_PLOTS }, (_, slotIndex) => ({ id: `plot-${slotIndex}`, userId, slotIndex, ...(planting ? {} : { seedItemId: "seed", plantedAt: new Date(Date.now() - 120000), finishAt: new Date(Date.now() + (harvesting ? -60000 : 3600000)) }) })));
    const api = await callerFor(farmingRouter, userId);
    const before = await api.getFarmState();
    if ("success" in before) throw new Error(before.message);
    const actions = {
      plantSeed: () => api.plantSeed({ plotId: "plot-0", seedItemId: "seed" }),
      plantAllEmpty: () => api.plantAllEmpty({ seedItemId: "seed" }),
      waterPlot: () => api.waterPlot({ plotId: "plot-0" }),
      waterAll: () => api.waterAll(),
      applyFertilizer: () => api.applyFertilizer({ plotId: "plot-0", userItemId: "fertilizer-stack" }),
      fertilizeAll: () => api.fertilizeAll({ userItemId: "fertilizer-stack" }),
      harvestPlot: () => api.harvestPlot({ plotId: "plot-0" }),
      harvestAll: () => api.harvestAll(),
    };
    const result = await actions[action]();
    expect(result.success, result.message).toBe(true);
    const awardedXp = Math.floor(baseXp * (bulk ? FARM_STARTING_PLOTS : 1) * (1 + TERRITORY_WAR_BOOST_PERCENT / 100));
    const saved = (await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))!;
    expect(saved.farmingExperience - before.farmingExperience).toBe(awardedXp);
    expect(result.farmingExperienceDelta).toBe(awardedXp);
    expect(applyFarmMutationPatch(before, result).farmingExperience).toBe(saved.farmingExperience);
    if (awardedXp > 0) expect(result.message).toContain(`(+${awardedXp} farming XP)`);
    else expect(result.message).not.toContain("farming XP");
  });
});
