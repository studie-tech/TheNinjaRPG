import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import { and, eq } from "drizzle-orm";
import { REGEN_SECONDS } from "@/drizzle/constants";
import {
  craftingRequirement,
  item,
  userCookingJob,
  userData,
  userItem,
  userQueue,
  userRaidBuff,
  userVote,
} from "@/drizzle/schema";
import { combatEnergyRecoverySql } from "@/libs/combat/database";
import { combatCacheEnergy } from "@/deltas/combat";
import { itemRouter } from "@/server/api/routers/item";
import { occupationRouter } from "@/server/api/routers/occupation";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { consumeMeal, settleCookingExperience } from "@/server/utils/cooking";
import {
  DecreaseCookingTime,
  DecreaseCraftingTime,
  IncreaseRegenerationTag,
  IncreaseStatTag,
} from "@/validators/combat";
import { MEAL_ITEM_DEFAULTS } from "@/validators/cooking";
import { makeCompleteBattle } from "../../../setup/combat";
import {
  insertItems,
  insertUserItems,
  insertUsers,
  insertUserVotes,
} from "../../../setup/factories";
import { queueEnergy } from "../../../setup/queues";
import {
  beforeStatements,
  failStatements,
  beforeTransaction,
} from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const userId = "cook";
const past = () => new Date(Date.now() - 60000);
const readUser = async () =>
  (await getTestDatabase()).query.userData.findFirst({
    where: eq(userData.userId, userId),
  });
const materials = async () =>
  (await getTestDatabase()).query.userItem.findMany({
    where: and(eq(userItem.userId, userId), eq(userItem.itemId, "rice")),
  });
const mealSnapshot = async (id = "edible") => {
  const db = await getTestDatabase();
  const [user, owned] = await Promise.all([
    db.query.userData.findFirst({
      where: eq(userData.userId, userId),
      with: { raidBuffs: true },
    }),
    db.query.userItem.findFirst({ where: eq(userItem.id, id), with: { item: true } }),
  ]);
  return { client: db, user: user!, owned: owned!, expectedQuantity: owned!.quantity };
};

describeWithDatabase("Cooking production and consumption", () => {
  beforeEach(async () => {
    await resetTables(
      userCookingJob,
      userRaidBuff,
      userQueue,
      userItem,
      craftingRequirement,
      item,
      userVote,
      userData,
    );
    const db = await getTestDatabase();
    await insertUsers([
      {
        userId,
        username: "Cook",
        status: "AWAKE",
        level: 50,
        rank: "JONIN",
        isOutlaw: true,
        occupation: null,
        federalStatus: "GOLD",
        regenAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    await insertUserVotes([{ userId }]);
    await insertItems([
      { id: "rice", name: "Rice", stackSize: 100, canStack: true },
      {
        id: "meal",
        name: "Rice Bowl",
        ...MEAL_ITEM_DEFAULTS,
        itemType: "MEAL",
        canBeCrafted: true,
        canBeTraded: true,
        canStack: true,
        stackSize: 100,
        cookingTimeSeconds: 60,
        cookingOutputQuantity: 3,
        cookingExperience: 10,
        mealDurationSeconds: 120,
        effects: [IncreaseStatTag.parse({ power: 10, statTypes: ["Ninjutsu"] })],
      },
      {
        id: "meal2",
        name: "Healing Soup",
        ...MEAL_ITEM_DEFAULTS,
        itemType: "MEAL",
        stackSize: 100,
        mealDurationSeconds: 90,
        effects: [IncreaseRegenerationTag.parse({ power: 20 })],
      },
    ]);
    await db.insert(craftingRequirement).values({
      id: "recipe-rice",
      craftItemId: "meal",
      requirementItemId: "rice",
      quantity: 2,
    });
    await insertUserItems([{ id: "rice-stack", userId, itemId: "rice", quantity: 20 }]);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([20, 2])(
    "rejects a direct craft when its %d-unit material stack is listed mid-request",
    async (quantity) => {
      const db = await getTestDatabase();
      await db.update(userItem).set({ quantity }).where(eq(userItem.id, "rice-stack"));
      const listing = beforeTransaction(db, () =>
        db
          .update(userItem)
          .set({ isInAuction: true })
          .where(eq(userItem.id, "rice-stack")),
      );
      const before = await readUser();

      const result = await callerForDatabase(
        occupationRouter,
        userId,
        listing,
      ).craftItem({ itemId: "meal", quantity: 1 });

      expect(result).toMatchObject({
        success: false,
        message: "Could not start crafting — materials changed, please try again",
      });
      expect(await materials()).toMatchObject([
        { id: "rice-stack", quantity, isInAuction: true },
      ]);
      expect(
        await db.query.userItem.findMany({ where: eq(userItem.itemId, "meal") }),
      ).toEqual([]);
      expect(await db.query.userCookingJob.findMany()).toEqual([]);
      expect((await readUser())?.updatedAt).toEqual(before?.updatedAt);
    },
  );

  it("returns active cooking receipts and queued rows without a getUser refetch", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ primaryElement: "Fire", secondaryElement: "Water" })
      .where(eq(userData.userId, userId));
    const initial = await fetchUpdatedUser({ client: db, userId });
    const key = [["profile", "getUser"], { type: "query" }];
    const client = new QueryClient();
    client.setQueryData(key, { userData: initial.user });
    let reads = 0;
    const observer = new QueryObserver(client, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: async () => {
        reads++;
        return { userData: initial.user };
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    try {
      const caller = await callerFor(occupationRouter, userId);
      for (let index = 0; index < 2; index++) {
        const revision = prepareUserUpdate(client, key);
        const result = await caller.craftItem({ itemId: "meal", quantity: 1 });
        expect(result.success).toBe(true);
        await updateUserCache(client, key, result.userPatch, {
          revision,
          achievementProgress: result.achievementProgress,
        });
        const cached = client.getQueryData<{
          userData: NonNullable<typeof initial.user>;
        }>(key)!.userData;
        expect(cached.cookingJobs).toEqual(await db.query.userCookingJob.findMany());
        expect(cached.queue).toEqual(await db.query.userQueue.findMany());
        expect(reads).toBe(0);
      }
    } finally {
      unsubscribe();
      client.clear();
    }
  });

  it("publishes cooking XP settled while starting another batch without a getUser refetch", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ primaryElement: "Fire", secondaryElement: "Water" })
      .where(eq(userData.userId, userId));
    await db.insert(userCookingJob).values({
      id: "completed-batch",
      userId,
      experience: 30,
      finishesAt: new Date(Date.now() + 60000),
    });
    const initial = await fetchUpdatedUser({ client: db, userId });
    expect(initial.user?.cookingExperience).toBe(0);
    await db
      .update(userCookingJob)
      .set({ finishesAt: past() })
      .where(eq(userCookingJob.id, "completed-batch"));
    const key = [["profile", "getUser"], { type: "query" }];
    const client = new QueryClient();
    client.setQueryData(key, { userData: initial.user });
    let reads = 0;
    const observer = new QueryObserver(client, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: async () => {
        reads++;
        return { userData: initial.user };
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    try {
      const revision = prepareUserUpdate(client, key);
      const result = await (await callerFor(occupationRouter, userId)).craftItem({
        itemId: "meal",
        quantity: 1,
      });
      const saved = (await readUser())!;
      const jobs = await db.query.userCookingJob.findMany();
      expect(result.success).toBe(true);
      expect(saved.cookingExperience).toBe(30);
      expect(result.userPatch?.cookingExperience).toBe(saved.cookingExperience);
      expect(result.userPatch?.cookingJobs).toEqual(jobs);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.id).not.toBe("completed-batch");
      await updateUserCache(client, key, result.userPatch, {
        revision,
        achievementProgress: result.achievementProgress,
      });
      const cached = client.getQueryData<{
        userData: NonNullable<typeof initial.user>;
      }>(key)!.userData;
      expect(cached.cookingExperience).toBe(saved.cookingExperience);
      expect(cached.cookingJobs).toEqual(jobs);
      expect(reads).toBe(0);
    } finally {
      unsubscribe();
      client.clear();
    }
  });

  it("captures the cooking bonus once per queued batch and retains it after equipment changes", async () => {
    const db = await getTestDatabase();
    await insertItems([
      {
        id: "production-gear",
        itemType: "ARMOR",
        maxDurability: 100,
        effects: [
          DecreaseCookingTime.parse({ power: 10 }),
          DecreaseCraftingTime.parse({ power: 60 }),
        ],
      },
    ]);
    await insertUserItems([
      {
        id: "production-gear-owned",
        userId,
        itemId: "production-gear",
        equipped: "CHEST",
        durability: 100,
      },
    ]);
    const caller = await callerFor(occupationRouter, userId);
    expect((await caller.craftItem({ itemId: "meal", quantity: 2 })).success).toBe(
      true,
    );
    expect((await caller.craftItem({ itemId: "meal", quantity: 2 })).success).toBe(
      true,
    );
    const queued = (await db.query.userQueue.findMany())[0]!;
    expect(queued.durationSeconds).toBe(60 * 3 * 2 * 0.9);
    expect(queued.finishesAt!.getTime() - queued.startsAt!.getTime()).toBe(
      queued.durationSeconds! * 1000,
    );
    await db
      .update(userItem)
      .set({ equipped: "NONE" })
      .where(eq(userItem.id, "production-gear-owned"));
    await db
      .update(userItem)
      .set({ craftingFinishedAt: past() })
      .where(eq(userItem.itemId, "meal"));
    const start = new Date(Date.now() - 1000);
    await db
      .update(userQueue)
      .set({
        startsAt: start,
        finishesAt: new Date(start.getTime() + queued.durationSeconds! * 1000),
      })
      .where(eq(userQueue.id, queued.id));
    await fetchUpdatedUser({ client: db, userId });
    const outputs = await db.query.userItem.findMany({
      where: eq(userItem.itemId, "meal"),
    });
    expect(
      outputs.some(
        (entry) =>
          entry.craftingFinishedAt?.getTime() ===
          start.getTime() + queued.durationSeconds! * 1000,
      ),
    ).toBe(true);
  });

  it("lets every occupation cook, multiplies outputs, and awards XP once at completion", async () => {
    const db = await getTestDatabase();
    const caller = await callerFor(occupationRouter, userId);
    expect((await caller.craftItem({ itemId: "meal", quantity: 2 })).success).toBe(
      true,
    );
    expect((await readUser())?.cookingExperience).toBe(0);
    expect((await readUser())?.craftingExperience).toBe(0);
    const outputs = await db.query.userItem.findMany({
      where: eq(userItem.itemId, "meal"),
    });
    expect(outputs.reduce((sum, row) => sum + row.quantity, 0)).toBe(6);
    expect((await materials())[0]?.quantity).toBe(16);
    const jobs = await db.query.userCookingJob.findMany();
    expect(await settleCookingExperience(db, userId, jobs)).toBe(false);
    await db.update(userCookingJob).set({ finishesAt: past() });
    const due = await db.query.userCookingJob.findMany();
    await Promise.all([
      settleCookingExperience(db, userId, due),
      settleCookingExperience(db, userId, due),
    ]);
    expect((await readUser())?.cookingExperience).toBe(60);
    expect(await db.query.userCookingJob.findMany()).toHaveLength(0);
  });

  it("shares capacity with Crafting, reserves waiting ingredients and refunds cancellation once", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ occupation: "CRAFTING" })
      .where(eq(userData.userId, userId));
    await insertItems([{ id: "crafted", name: "Craft", canBeCrafted: true }]);
    await db.insert(craftingRequirement).values({
      id: "craft-rice",
      craftItemId: "crafted",
      requirementItemId: "rice",
      quantity: 1,
    });
    const caller = await callerFor(occupationRouter, userId);
    expect((await caller.craftItem({ itemId: "meal", quantity: 1 })).success).toBe(
      true,
    );
    expect((await caller.craftItem({ itemId: "crafted", quantity: 1 })).success).toBe(
      true,
    );
    const queue = await db.query.userQueue.findMany();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.itemId).toBe("crafted");
    expect((await materials())[0]?.quantity).toBe(17);
    const results = await Promise.all([
      caller.cancelQueuedCraft({ queueId: queue[0]!.id }),
      caller.cancelQueuedCraft({ queueId: queue[0]!.id }),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect((await materials()).reduce((sum, row) => sum + row.quantity, 0)).toBe(18);
  });

  it("settles queued offline cooking and completion XP through profile refresh", async () => {
    const db = await getTestDatabase();
    const caller = await callerFor(occupationRouter, userId);
    await caller.craftItem({ itemId: "meal", quantity: 1 });
    await caller.craftItem({ itemId: "meal", quantity: 1 });
    await db
      .update(userItem)
      .set({ craftingFinishedAt: new Date(Date.now() - 600000) })
      .where(eq(userItem.itemId, "meal"));
    await db.update(userCookingJob).set({ finishesAt: new Date(Date.now() - 600000) });
    await db.update(userQueue).set({
      startsAt: new Date(Date.now() - 600000),
      finishesAt: new Date(Date.now() - 420000),
    });
    await fetchUpdatedUser({ client: db, userId });
    expect((await readUser())?.cookingExperience).toBe(60);
    expect(await db.query.userQueue.findMany()).toHaveLength(0);
    expect(
      (await db.query.userItem.findMany({ where: eq(userItem.itemId, "meal") })).reduce(
        (sum, row) => sum + row.quantity,
        0,
      ),
    ).toBe(6);
  });

  it("returns the loaded profile after a Cooking XP failure and retries the receipt exactly once", async () => {
    const db = await getTestDatabase();
    const receipt = { id: "cooking-retry", userId, experience: 30, finishesAt: past() };
    await db.insert(userCookingJob).values(receipt);
    const failing = failStatements(db, userData);
    const warning = vi
      .spyOn(Sentry, "captureException")
      .mockReturnValue("warning-event");

    const failed = await fetchUpdatedUser({ client: failing, userId });
    expect(failed.user?.userId).toBe(userId);
    expect(failed.user?.cookingExperience).toBe(0);
    expect((await readUser())?.cookingExperience).toBe(0);
    expect(await db.query.userCookingJob.findMany()).toEqual([receipt]);
    expect(warning).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Statement failed on purpose" }),
      {
        level: "warning",
        tags: { source: "settleCookingExperience" },
      },
    );

    const retried = await fetchUpdatedUser({ client: db, userId });
    expect(retried.user?.cookingExperience).toBe(30);
    expect(retried.requiresUserRefresh).toBe(true);
    expect(await db.query.userCookingJob.findMany()).toEqual([]);
    expect(
      (await fetchUpdatedUser({ client: db, userId })).user?.cookingExperience,
    ).toBe(30);
    expect((await readUser())?.cookingExperience).toBe(30);
  });

  it("reconciles committed receipts when another receipt fails, then retries only the pending XP", async () => {
    const db = await getTestDatabase();
    const receipts = [
      { id: "first", userId, experience: 20, finishesAt: past() },
      { id: "second", userId, experience: 30, finishesAt: past() },
      { id: "third", userId, experience: 40, finishesAt: past() },
    ];
    await db.insert(userCookingJob).values(receipts);
    const failure = new Error("Second receipt failed");
    const failing = beforeStatements(db, userData, [
      async () => {},
      async () => {
        throw failure;
      },
    ]);
    const warning = vi
      .spyOn(Sentry, "captureException")
      .mockReturnValue("warning-event");

    const result = await fetchUpdatedUser({ client: failing, userId });
    expect(result.user?.cookingExperience).toBe(60);
    expect(result.requiresUserRefresh).toBe(true);
    expect((await readUser())?.cookingExperience).toBe(60);
    expect(
      (await db.query.userCookingJob.findMany()).map((job) => job.experience),
    ).toEqual([30]);
    expect(warning).toHaveBeenCalledWith(failure, {
      level: "warning",
      tags: { source: "settleCookingExperience" },
    });

    expect(
      (await fetchUpdatedUser({ client: db, userId })).user?.cookingExperience,
    ).toBe(90);
    expect(await db.query.userCookingJob.findMany()).toEqual([]);
    expect(
      (await fetchUpdatedUser({ client: db, userId })).user?.cookingExperience,
    ).toBe(90);
  });

  it("keeps a zero-XP delivery marker when cleanup fails and cannot replay a stale receipt", async () => {
    const db = await getTestDatabase();
    const receipt = { id: "cleanup-retry", userId, experience: 30, finishesAt: past() };
    await db.insert(userCookingJob).values(receipt);
    const failure = new Error("Receipt cleanup failed");
    const failing = beforeStatements(db, userCookingJob, [
      async () => {},
      async () => {
        throw failure;
      },
    ]);
    const warning = vi
      .spyOn(Sentry, "captureException")
      .mockReturnValue("warning-event");

    expect(await settleCookingExperience(failing, userId, [receipt])).toBe(true);
    expect((await readUser())?.cookingExperience).toBe(30);
    expect(await db.query.userCookingJob.findMany()).toEqual([
      { ...receipt, experience: 0 },
    ]);
    expect(warning).toHaveBeenCalledWith(failure, {
      level: "warning",
      tags: { source: "settleCookingExperience" },
    });
    expect(await settleCookingExperience(db, userId, [receipt])).toBe(true);
    expect((await readUser())?.cookingExperience).toBe(30);
    expect(await db.query.userCookingJob.findMany()).toEqual([]);
  });

  it("guards receipt owner, exact XP and due time while cleaning up due zero-XP recipes", async () => {
    const db = await getTestDatabase();
    const due = past();
    await db.insert(userCookingJob).values([
      { id: "changed", userId, experience: 31, finishesAt: due },
      { id: "foreign", userId: "other", experience: 30, finishesAt: due },
      {
        id: "future",
        userId,
        experience: 30,
        finishesAt: new Date(Date.now() + 60000),
      },
      { id: "zero", userId, experience: 0, finishesAt: due },
    ]);
    const stale = ["changed", "foreign", "future"].map((id) => ({
      id,
      experience: 30,
      finishesAt: due,
    }));
    expect(await settleCookingExperience(db, userId, stale)).toBe(true);
    expect((await readUser())?.cookingExperience).toBe(0);
    expect(
      (await db.query.userCookingJob.findMany()).map((job) => job.id).sort(),
    ).toEqual(["changed", "foreign", "future"]);
  });

  it("increments XP once per receipt across simultaneous settlements of several jobs", async () => {
    const db = await getTestDatabase();
    const receipts = [10, 20, 30].map((experience) => ({
      id: `parallel-${experience}`,
      userId,
      experience,
      finishesAt: past(),
    }));
    await db.insert(userCookingJob).values(receipts);
    expect(
      await Promise.all([
        settleCookingExperience(db, userId, receipts),
        settleCookingExperience(db, userId, receipts),
      ]),
    ).toEqual([true, true]);
    expect((await readUser())?.cookingExperience).toBe(60);
    expect(await db.query.userCookingJob.findMany()).toEqual([]);
    expect(await settleCookingExperience(db, userId, receipts)).toBe(true);
    expect((await readUser())?.cookingExperience).toBe(60);
  });

  it("keeps profile reconciliation after Cooking XP commits but the refreshed profile read fails", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ primaryElement: "Fire", secondaryElement: "Water" })
      .where(eq(userData.userId, userId));
    await db
      .insert(userCookingJob)
      .values({ id: "cooking-reread", userId, experience: 30, finishesAt: past() });
    const read = db.query.userData.findFirst.bind(db.query.userData);
    const error = new Error("Refreshed profile unavailable");
    let profileReads = 0;
    vi.spyOn(db.query.userData, "findFirst").mockImplementation(((
      config: Parameters<typeof read>[0],
    ) => {
      if (config?.with && ++profileReads === 2) throw error;
      return read(config);
    }) as never);
    const warning = vi
      .spyOn(Sentry, "captureException")
      .mockReturnValue("warning-event");

    const result = await fetchUpdatedUser({ client: db, userId });
    expect(result.user?.userId).toBe(userId);
    expect(result.user?.cookingExperience).toBe(0);
    expect(result.requiresUserRefresh).toBe(true);
    expect(result.requiresProgressionRefresh).toBe(true);
    expect(profileReads).toBe(2);
    expect(warning).toHaveBeenCalledWith(error, {
      level: "warning",
      tags: { source: "settleCookingExperience" },
    });
    expect((await readUser())?.cookingExperience).toBe(30);
    expect(await db.query.userCookingJob.findMany()).toEqual([]);
    expect(
      (await fetchUpdatedUser({ client: db, userId })).user?.cookingExperience,
    ).toBe(30);
    expect((await readUser())?.cookingExperience).toBe(30);
  });

  it("rejects rank, ingredient and shared-capacity failures before taking ingredients", async () => {
    const db = await getTestDatabase();
    const caller = await callerFor(occupationRouter, userId);
    await db.update(item).set({ cookingMinLevel: 25 }).where(eq(item.id, "meal"));
    expect((await caller.craftItem({ itemId: "meal", quantity: 1 })).success).toBe(
      false,
    );
    await db.update(item).set({ cookingMinLevel: 1 }).where(eq(item.id, "meal"));
    await db
      .update(userData)
      .set({ federalStatus: "NONE" })
      .where(eq(userData.userId, userId));
    await caller.craftItem({ itemId: "meal", quantity: 1 });
    await caller.craftItem({ itemId: "meal", quantity: 1 });
    expect((await caller.craftItem({ itemId: "meal", quantity: 1 })).success).toBe(
      false,
    );
    expect((await materials())[0]?.quantity).toBe(16);
  });

  it("rejects duplicate consumption, extends the same meal and replaces a different one", async () => {
    const db = await getTestDatabase();
    await insertUserItems([
      { id: "edible", userId, itemId: "meal", quantity: 3 },
      { id: "soup", userId, itemId: "meal2", quantity: 1 },
    ]);
    const caller = await callerFor(itemRouter, userId);
    const results = await Promise.all([
      caller.consume({ userItemId: "edible", expectedQuantity: 3 }),
      caller.consume({ userItemId: "edible", expectedQuantity: 3 }),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const initial = (await db.query.userRaidBuff.findMany())[0]!;
    expect(
      (await caller.consume({ userItemId: "edible", expectedQuantity: 2 })).success,
    ).toBe(true);
    const extended = (await db.query.userRaidBuff.findMany())[0]!;
    expect(extended.expiresAt.getTime() - initial.expiresAt.getTime()).toBe(120000);
    expect(
      (await caller.consume({ userItemId: "soup", expectedQuantity: 1 })).success,
    ).toBe(true);
    const replaced = await db.query.userRaidBuff.findMany();
    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.itemId).toBe("meal2");
    expect(replaced[0]!.expiresAt.getTime()).toBeLessThan(extended.expiresAt.getTime());
    expect(
      await db.query.userItem.findFirst({ where: eq(userItem.id, "soup") }),
    ).toBeUndefined();
    expect(
      (await caller.consume({ userItemId: "edible", expectedQuantity: 3 })).success,
    ).toBe(false);
  });

  it("allows only one competing meal to debit its stack and replace the account effect", async () => {
    const db = await getTestDatabase();
    await insertUserItems([
      { id: "edible", userId, itemId: "meal", quantity: 1 },
      { id: "soup", userId, itemId: "meal2", quantity: 1 },
    ]);
    const [rice, soup] = await Promise.all([mealSnapshot(), mealSnapshot("soup")]);
    const results = await Promise.all([consumeMeal(rice), consumeMeal(soup)]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const buff = (await db.query.userRaidBuff.findMany())[0]!;
    const remaining = await db.query.userItem.findMany({
      where: and(eq(userItem.userId, userId), eq(userItem.quantity, 1)),
    });
    expect(remaining.map((row) => row.itemId)).toEqual([
      buff.itemId === "meal" ? "meal2" : "meal",
    ]);
    expect(buff.effects).toEqual(
      buff.itemId === "meal" ? rice.owned.item.effects : soup.owned.item.effects,
    );
  });

  it.each([
    ["quantity", { quantity: 2 }],
    ["owner", { userId: "other" }],
    ["item", { itemId: "meal2" }],
    ["storage", { storedAtHome: true }],
    ["auction", { isInAuction: true }],
    ["equipment", { equipped: "HAND_1" }],
    ["unfinished output", { craftingFinishedAt: new Date(Date.now() + 60000) }],
  ] as const)(
    "preserves the current meal and item when its %s changes after validation",
    async (_, change) => {
      const db = await getTestDatabase();
      await insertUsers([{ userId: "other", username: "Other" }]);
      await insertUserItems([{ id: "edible", userId, itemId: "meal", quantity: 1 }]);
      const snapshot = await mealSnapshot();
      const client = beforeStatements(db, userData, [
        async () => db.update(userItem).set(change).where(eq(userItem.id, "edible")),
      ]);
      expect((await consumeMeal({ ...snapshot, client })).success).toBe(false);
      expect(
        await db.query.userItem.findFirst({ where: eq(userItem.id, "edible") }),
      ).toEqual(expect.objectContaining({ quantity: 1, ...change }));
      const placeholder = (await db.query.userRaidBuff.findMany())[0]!;
      expect(placeholder.effects).toEqual([]);
      expect(placeholder.itemId).toBeNull();
      expect(placeholder.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect((await readUser())?.updatedAt).toEqual(snapshot.user.updatedAt);
    },
  );

  it.each([
    ["snapshot", { updatedAt: new Date(Date.now() + 60000) }],
    ["status", { status: "ASLEEP" }],
    ["battle", { battleId: "busy" }],
  ] as const)(
    "leaves the meal available when account %s changes after validation",
    async (_, change) => {
      const db = await getTestDatabase();
      await insertUserItems([{ id: "edible", userId, itemId: "meal", quantity: 1 }]);
      const snapshot = await mealSnapshot();
      const client = beforeStatements(db, userData, [
        async () => db.update(userData).set(change).where(eq(userData.userId, userId)),
      ]);
      expect((await consumeMeal({ ...snapshot, client })).success).toBe(false);
      expect(
        await db.query.userItem.findFirst({ where: eq(userItem.id, "edible") }),
      ).toMatchObject({ quantity: 1 });
      expect((await db.query.userRaidBuff.findMany())[0]?.effects).toEqual([]);
      expect(await readUser()).toEqual(expect.objectContaining(change));
    },
  );

  it("rejects a meal buff owned by another account without altering it", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "other", username: "Other" }]);
    await insertUserItems([{ id: "edible", userId, itemId: "meal", quantity: 1 }]);
    const foreign = {
      id: `meal-${userId}`,
      userId: "other",
      itemId: "meal2",
      effects: [],
      expiresAt: new Date(Date.now() + 60000),
      createdAt: past(),
    };
    await db.insert(userRaidBuff).values(foreign);
    const snapshot = await mealSnapshot();
    expect((await consumeMeal(snapshot)).success).toBe(false);
    expect(await db.query.userRaidBuff.findMany()).toEqual([
      { ...foreign, questId: null },
    ]);
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "edible") }))
        ?.quantity,
    ).toBe(1);
  });

  it("preserves the stack and active effect when the atomic meal write fails", async () => {
    const db = await getTestDatabase();
    await insertUserItems([{ id: "edible", userId, itemId: "meal", quantity: 1 }]);
    const current = {
      id: `meal-${userId}`,
      userId,
      itemId: "meal2",
      effects: [IncreaseRegenerationTag.parse({ power: 20 })],
      expiresAt: new Date(Date.now() + 60000),
      createdAt: past(),
    };
    await db.insert(userRaidBuff).values(current);
    const snapshot = await mealSnapshot();
    await expect(
      consumeMeal({ ...snapshot, client: failStatements(db, userData) }),
    ).rejects.toThrow("Statement failed on purpose");
    expect(await db.query.userRaidBuff.findMany()).toEqual([
      { ...current, questId: null },
    ]);
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "edible") }))
        ?.quantity,
    ).toBe(1);
    expect((await readUser())?.updatedAt).toEqual(snapshot.user.updatedAt);
  });

  it("reports committed consumption as success when empty-stack cleanup fails", async () => {
    const db = await getTestDatabase();
    await insertUserItems([{ id: "edible", userId, itemId: "meal", quantity: 1 }]);
    const snapshot = await mealSnapshot();
    const failure = new Error("Empty stack cleanup failed");
    const client = beforeStatements(db, userItem, [
      async () => {},
      async () => {
        throw failure;
      },
    ]);
    const warning = vi
      .spyOn(Sentry, "captureException")
      .mockReturnValue("warning-event");
    expect(await consumeMeal({ ...snapshot, client })).toMatchObject({
      success: true,
      userPatch: { raidBuffs: expect.any(Array) },
    });
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "edible") }))
        ?.quantity,
    ).toBe(0);
    const buff = (await db.query.userRaidBuff.findMany())[0]!;
    expect(buff.effects).toEqual(snapshot.owned.item.effects);
    expect(warning).toHaveBeenCalledWith(failure, {
      level: "warning",
      tags: { source: "consumeMeal" },
    });
    expect((await consumeMeal(snapshot)).success).toBe(false);
    expect(await db.query.userRaidBuff.findMany()).toEqual([buff]);
  });

  it("settles expired regeneration before the normal five-minute throttle and includes queued Energy", async () => {
    const db = await getTestDatabase();
    const now = new Date();
    const step = REGEN_SECONDS * 1000;
    await db
      .update(userData)
      .set({
        regeneration: 10,
        regenAt: new Date(now.getTime() - 4 * step),
        updatedAt: now,
        curHealth: 0,
        maxHealth: 1000,
        curChakra: 0,
        maxChakra: 1000,
        curStamina: 0,
        maxStamina: 1000,
        curEnergy: 0,
        maxEnergy: 1000,
      })
      .where(eq(userData.userId, userId));
    await db.insert(userRaidBuff).values({
      id: "expired-regen",
      userId,
      effects: [IncreaseRegenerationTag.parse({ power: 50 })],
      createdAt: new Date(now.getTime() - 5 * step),
      expiresAt: new Date(now.getTime() - 1.5 * step),
    });
    await queueEnergy(userId, [{ stat: "offence", energy: 20 }]);
    const result = await fetchUpdatedUser({ client: db, userId });
    expect(result.user?.curHealth).toBe(50);
    expect(result.user?.curEnergy).toBeCloseTo(30);
    expect(result.user?.regeneration).toBe(10);
    expect((await readUser())?.curHealth).toBe(50);
  });

  it("bounds battle Energy recovery by the meal expiry in SQL and the completion cache", async () => {
    const db = await getTestDatabase();
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date(from.getTime() + 2 * REGEN_SECONDS * 1000);
    const periods = [
      {
        startsAt: from.getTime(),
        endsAt: from.getTime() + REGEN_SECONDS * 1000,
        bonus: 5,
      },
    ];
    const snapshot = makeCompleteBattle({
      extraState: {
        energyCapacity: { [userId]: 100 },
        energyRegeneration: { [userId]: 10 },
        energyRegenerationPeriods: { [userId]: periods },
      },
    });
    await db
      .update(userData)
      .set({ curEnergy: 0, regenAt: from })
      .where(eq(userData.userId, userId));
    await db
      .update(userData)
      .set({ curEnergy: combatEnergyRecoverySql(snapshot, userId, 0, to) })
      .where(eq(userData.userId, userId));
    expect((await readUser())?.curEnergy).toBe(25);
    expect(
      combatCacheEnergy(
        { curEnergy: 0, regenAt: from.toISOString() },
        100,
        10,
        to,
        0,
        periods,
      ),
    ).toBe(25);
  });

  it("wakes an opted-in sleeper when consuming a meal", async () => {
    const db = await getTestDatabase();
    await insertUserItems([{ id: "edible", userId, itemId: "meal", quantity: 1 }]);
    await db
      .update(userData)
      .set({ status: "ASLEEP", autoWakeUp: true })
      .where(eq(userData.userId, userId));
    const result = await (await callerFor(itemRouter, userId)).consume({
      userItemId: "edible",
      expectedQuantity: 1,
    });
    expect(result).toMatchObject({
      success: true,
      actionNotice: "This action woke you up.",
    });
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))
        ?.status,
    ).toBe("AWAKE");
    expect(await db.query.userRaidBuff.findMany()).toHaveLength(1);
  });

  it.each(["ASLEEP", "BATTLE", "TRAVEL"] as const)(
    "prevents eating while %s",
    async (status) => {
      const db = await getTestDatabase();
      await insertUserItems([{ id: "edible", userId, itemId: "meal", quantity: 1 }]);
      await db
        .update(userData)
        .set({
          status,
          autoWakeUp: false,
          ...(status === "BATTLE" ? { battleId: "busy" } : {}),
        })
        .where(eq(userData.userId, userId));
      const caller = await callerFor(itemRouter, userId);
      expect(
        (await caller.consume({ userItemId: "edible", expectedQuantity: 1 })).success,
      ).toBe(false);
      expect(
        (await db.query.userItem.findFirst({ where: eq(userItem.id, "edible") }))
          ?.quantity,
      ).toBe(1);
      expect(await db.query.userRaidBuff.findMany()).toHaveLength(0);
    },
  );
});
