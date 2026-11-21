import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { MAP_WAKE_ISLAND_SECTOR } from "@/drizzle/constants";
import {
  huntingSession,
  item,
  quest,
  questHistory,
  userData,
  userItem,
  userItemImbuement,
  userQueue,
  userVote,
} from "@/drizzle/schema";
import { AUTO_WAKE_MESSAGE } from "@/libs/actionReadiness";
import {
  listSupplyRequestStacks,
  submitSupplyRequestAtomically,
} from "@/queries/supplyRequest";
import { occupationRouter } from "@/server/api/routers/occupation";
import { periodStart } from "@/utils/time";
import { AllObjectives, QuestTracker } from "@/validators/objectives";
import {
  insertItems,
  insertQuestHistory,
  insertQuests,
  insertUserItems,
  insertUsers,
  insertUserVotes,
} from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";
import { requireUser } from "../../../../setup/userReads";

const owner = "supply-owner";
const readStack = async () =>
  (await getTestDatabase()).query.userItem.findFirst({
    where: eq(userItem.id, "stock"),
  });
const reviewed = async () => {
  const caller = await callerFor(occupationRouter, owner);
  const view = await caller.getSupplyRequest();
  const stack = view.stacks.find((row) => row.id === "stock")!;
  return {
    caller,
    input: {
      userItemId: stack.id,
      quantity: 200,
      expectedQuantity: stack.quantity,
      expectedUpdatedAt: stack.updatedAt,
      occupation: "GATHERING" as const,
      auctionMaxPrice: stack.auctionMaxPrice,
    },
  };
};

describeWithDatabase("daily supply requests", () => {
  beforeEach(async () => {
    await resetTables(
      huntingSession,
      userQueue,
      userItemImbuement,
      userItem,
      item,
      questHistory,
      quest,
      userVote,
      userData,
    );
    await insertUsers([
      {
        userId: owner,
        username: "Supplier",
        occupation: "GATHERING",
        sector: MAP_WAKE_ISLAND_SECTOR,
        status: "AWAKE",
        rank: "JONIN",
        money: 1000,
        gatheringExperience: 10,
      },
      { userId: "other", username: "Other", status: "AWAKE" },
    ]);
    await insertUserVotes([{ userId: owner }]);
    await insertItems([
      {
        id: "herb",
        name: "Herb",
        canBeGathered: true,
        auctionMaxPrice: 11,
        stackSize: 9999,
      },
      { id: "craft", name: "Craft", canBeCrafted: true, auctionMaxPrice: 20 },
      { id: "unpriced", name: "Unpriced", canBeGathered: true },
    ]);
    await insertUserItems([
      { id: "stock", userId: owner, itemId: "herb", quantity: 250 },
      { id: "craft-stock", userId: owner, itemId: "craft", quantity: 200 },
      { id: "unpriced-stock", userId: owner, itemId: "unpriced", quantity: 200 },
    ]);
  });

  it("lists only matching priced stock and pays bundles with a partial remainder", async () => {
    const { caller, input } = await reviewed();
    expect((await caller.getSupplyRequest()).stacks.map((row) => row.id)).toEqual([
      "stock",
    ]);
    const result = await caller.submitSupplyRequest(input);
    expect(result.success).toBe(true);
    expect(result.userDelta).toEqual({ money: 1320 });
    expect(result.userPatch?.gatheringExperience).toBe(4010);
    expect(result.userPatch?.craftingExperience).toBe(0);
    expect(result.userPatch?.huntingExperience).toBe(0);
    expect(result.userPatch?.supplyRequestAt).toBeInstanceOf(Date);
    expect(result.inventoryChanges?.[0]?.quantity).toBe(50);
    expect((await readStack())?.quantity).toBe(50);
    const user = await requireUser(owner);
    expect(user.money).toBe(2320);
    expect(user.gatheringExperience).toBe(4010);
    expect(user.huntingExperience).toBe(0);
    expect(user.craftingExperience).toBe(0);
    expect(user.supplyRequestAt).not.toBeNull();
  });

  it("loads only the selected carried stack for its owner", async () => {
    const db = await getTestDatabase();
    const stacks = await listSupplyRequestStacks(db, owner);
    expect(stacks).toHaveLength(3);
    expect(await listSupplyRequestStacks(db, owner, "stock")).toEqual(
      stacks.filter((stack) => stack.id === "stock"),
    );
    expect(await listSupplyRequestStacks(db, "other", "stock")).toEqual([]);
    expect(await listSupplyRequestStacks(db, owner, "missing")).toEqual([]);
  });

  it.each([
    { userId: "other" },
    { quantity: 0 },
    { storedAtHome: true },
    { equipped: "HAND_1" as const },
    { isInAuction: true },
    { craftingFinishedAt: new Date("2099-01-01") },
    { activeVariantId: "variant" },
    { level: 2 },
    { experience: 1 },
    { durability: 1 },
  ])("rejects a selected stack that became unavailable: %j", async (patch) => {
    const { caller, input } = await reviewed();
    const db = await getTestDatabase();
    await db.update(userItem).set(patch).where(eq(userItem.id, "stock"));
    expect((await caller.getSupplyRequest()).stacks).toEqual([]);
    expect((await caller.submitSupplyRequest(input)).success).toBe(false);
    expect((await requireUser(owner)).money).toBe(1000);
    expect((await requireUser(owner)).supplyRequestAt).toBeNull();
  });

  it("excludes imbued stacks from both review and selected submission", async () => {
    const { caller, input } = await reviewed();
    const db = await getTestDatabase();
    await db.insert(userItemImbuement).values({
      id: "imbued",
      userItemId: "stock",
      imbuementItemId: "craft",
      craftingFinishedAt: new Date(0),
    });
    expect((await caller.getSupplyRequest()).stacks).toEqual([]);
    expect((await caller.submitSupplyRequest(input)).success).toBe(false);
    expect((await readStack())?.quantity).toBe(250);
    expect((await requireUser(owner)).money).toBe(1000);
    expect((await requireUser(owner)).supplyRequestAt).toBeNull();
  });

  it("rejects partial bundles, multiple stacks and excess stock", async () => {
    const { caller, input } = await reviewed();
    for (const quantity of [0, 99, 101, 250])
      await expect(
        caller.submitSupplyRequest({ ...input, quantity }),
      ).rejects.toThrow();
    expect(
      (await caller.submitSupplyRequest({ ...input, quantity: 300 })).success,
    ).toBe(false);
    expect((await readStack())?.quantity).toBe(250);
    expect((await requireUser(owner)).money).toBe(1000);
  });

  it("rejects stale reviews and item prices without consuming the daily claim", async () => {
    const { caller, input } = await reviewed();
    expect(
      (await caller.submitSupplyRequest({ ...input, expectedQuantity: 251 })).success,
    ).toBe(false);
    expect(
      (await caller.submitSupplyRequest({ ...input, auctionMaxPrice: 99 })).success,
    ).toBe(false);
    expect(
      (await caller.submitSupplyRequest({ ...input, expectedUpdatedAt: new Date(0) }))
        .success,
    ).toBe(false);
    expect((await requireUser(owner)).supplyRequestAt).toBeNull();
  });

  it("pays a concurrent duplicate only once", async () => {
    const { caller, input } = await reviewed();
    const results = await Promise.all([
      caller.submitSupplyRequest(input),
      caller.submitSupplyRequest(input),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect((await readStack())?.quantity).toBe(50);
    expect((await requireUser(owner)).money).toBe(2320);
  });

  it("cannot claim again by switching profession", async () => {
    const { caller, input } = await reviewed();
    expect((await caller.submitSupplyRequest(input)).success).toBe(true);
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ occupation: "CRAFTING" })
      .where(eq(userData.userId, owner));
    expect((await caller.getSupplyRequest()).blocked).toContain("already");
    const stack = (await caller.getSupplyRequest()).stacks[0]!;
    expect(
      (
        await caller.submitSupplyRequest({
          userItemId: stack.id,
          quantity: 100,
          expectedQuantity: stack.quantity,
          expectedUpdatedAt: stack.updatedAt,
          occupation: "CRAFTING",
          auctionMaxPrice: stack.auctionMaxPrice,
        })
      ).success,
    ).toBe(false);
  });

  it.each(["CRAFTING", "HUNTER"] as const)(
    "rewards only the matched %s profession",
    async (occupation) => {
      const db = await getTestDatabase();
      await db.update(userData).set({ occupation }).where(eq(userData.userId, owner));
      await db
        .update(item)
        .set({
          canBeCrafted: occupation === "CRAFTING",
          canBeHunted: occupation === "HUNTER",
        })
        .where(eq(item.id, "herb"));
      const { caller, input } = await reviewed();
      expect((await caller.submitSupplyRequest({ ...input, occupation })).success).toBe(
        true,
      );
      const user = await requireUser(owner);
      expect(user.craftingExperience).toBe(occupation === "CRAFTING" ? 4000 : 0);
      expect(user.huntingExperience).toBe(occupation === "HUNTER" ? 4000 : 0);
      expect(user.gatheringExperience).toBe(10);
    },
  );

  it("accepts yesterday's claim after the UTC reset", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({
        supplyRequestAt: new Date(periodStart("daily", new Date()).getTime() - 1),
      })
      .where(eq(userData.userId, owner));
    const { caller, input } = await reviewed();
    expect((await caller.getSupplyRequest()).blocked).toBeNull();
    expect((await caller.submitSupplyRequest(input)).success).toBe(true);
  });

  it("advances profession XP objectives without counting a supply exchange as production", async () => {
    const db = await getTestDatabase();
    await insertQuests([
      {
        id: "supply-xp",
        questType: "mission",
        content: {
          objectives: [
            AllObjectives.parse({
              id: "xp",
              task: "gathering_experience_gained",
              value: 8000,
            }),
            AllObjectives.parse({
              id: "gathered",
              task: "herbs_gathered",
              value: 1000,
            }),
          ],
        },
      },
    ]);
    await insertQuestHistory([
      { userId: owner, questId: "supply-xp", questType: "mission" },
    ]);
    await db
      .update(userData)
      .set({
        questData: [
          QuestTracker.parse({
            id: "supply-xp",
            goals: [
              { id: "xp", value: 0, done: false },
              { id: "gathered", value: 0, done: false },
            ],
          }),
        ],
      })
      .where(eq(userData.userId, owner));
    const { caller, input } = await reviewed();
    expect((await caller.submitSupplyRequest(input)).success).toBe(true);
    const goals = (await requireUser(owner)).questData?.find(
      (entry) => entry.id === "supply-xp",
    )?.goals;
    expect(goals?.find((goal) => goal.id === "xp")?.value).toBe(4000);
    expect(goals?.find((goal) => goal.id === "gathered")?.value).toBe(0);
  });

  it("commits automatic wake only together with an accepted supply payment", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ status: "ASLEEP", autoWakeUp: true })
      .where(eq(userData.userId, owner));
    const { caller, input } = await reviewed();
    expect(
      (await caller.submitSupplyRequest({ ...input, auctionMaxPrice: 999 })).success,
    ).toBe(false);
    expect((await requireUser(owner)).status).toBe("ASLEEP");
    const result = await caller.submitSupplyRequest(input);
    expect(result.success).toBe(true);
    expect(result.actionNotice).toBe(AUTO_WAKE_MESSAGE);
    const user = await requireUser(owner);
    expect(user.status).toBe("AWAKE");
    expect(user.money).toBe(2320);
    expect((await readStack())?.quantity).toBe(50);
  });

  it("leaves a sleeping character untouched when automatic wake is disabled", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ status: "ASLEEP", autoWakeUp: false })
      .where(eq(userData.userId, owner));
    const { caller, input } = await reviewed();
    expect((await caller.submitSupplyRequest(input)).success).toBe(false);
    const user = await requireUser(owner);
    expect(user.status).toBe("ASLEEP");
    expect(user.money).toBe(1000);
    expect(user.supplyRequestAt).toBeNull();
  });

  it("guards inventory, price, character location and profession again in the atomic write", async () => {
    const db = await getTestDatabase();
    const user = await requireUser(owner);
    const stack = (await readStack())!;
    const request = {
      quantity: 200,
      auctionMaxPrice: 11,
      ryo: 1320,
      experience: 4000,
      claimedAt: new Date(),
      updatedAt: new Date(Date.now() + 100),
      questData: [],
    };
    const claim = () =>
      submitSupplyRequestAtomically(
        db,
        { ...user, occupation: "GATHERING" },
        stack,
        request,
      );
    for (const patch of [
      { isInAuction: true },
      { equipped: "HAND_1" as const },
      { storedAtHome: true },
      { quantity: 249 },
      { activeVariantId: "variant" },
    ]) {
      await db.update(userItem).set(patch).where(eq(userItem.id, stack.id));
      expect((await claim()).rowsAffected).toBe(0);
      await db.update(userItem).set(stack).where(eq(userItem.id, stack.id));
    }
    await db.insert(userItemImbuement).values({
      id: "imbued",
      userItemId: stack.id,
      imbuementItemId: "craft",
      craftingFinishedAt: new Date(0),
    });
    expect((await claim()).rowsAffected).toBe(0);
    await db.delete(userItemImbuement);
    await db.update(item).set({ auctionMaxPrice: 99 }).where(eq(item.id, stack.itemId));
    expect((await claim()).rowsAffected).toBe(0);
    await db.update(item).set({ auctionMaxPrice: 11 }).where(eq(item.id, stack.itemId));
    for (const patch of [
      { sector: 1 },
      { occupation: "HUNTER" as const },
      { status: "ASLEEP" as const },
      { isBanned: true },
      { supplyRequestAt: new Date() },
    ]) {
      await db.update(userData).set(patch).where(eq(userData.userId, owner));
      expect((await claim()).rowsAffected).toBe(0);
      await db.update(userData).set(user).where(eq(userData.userId, owner));
    }
    expect((await requireUser(owner)).money).toBe(1000);
    expect((await readStack())?.quantity).toBe(250);
    expect((await claim()).rowsAffected).toBe(2);
  });
});
