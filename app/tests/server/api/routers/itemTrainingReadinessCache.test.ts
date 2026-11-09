import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { eq } from "drizzle-orm";
import type { UserUpdate } from "@/deltas/profile";
import { CRAFTING_REQUIRED_EXP, ITEM_LEVEL_CAP } from "@/drizzle/constants";
import {
  item,
  itemLoadout,
  jutsu,
  jutsuLoadout,
  quest,
  questHistory,
  userData,
  userItem,
  userItemImbuement,
  userJutsu,
  userQueue,
  userVote,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { itemRouter } from "@/server/api/routers/item";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { occupationRouter } from "@/server/api/routers/occupation";
import { profileRouter } from "@/server/api/routers/profile";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { getTagSchema } from "@/validators/combat";
import {
  insertItems,
  insertJutsus,
  insertUserItems,
  insertUsers,
  insertUserVotes,
} from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const userId = "readiness-cache-owner";
const key = [["profile", "getUser"], { type: "query" }];

/** Apply a real mutation response through the same captured-revision profile pipeline as the UI. */
const applyMutation = async (mutate: () => Promise<UserUpdate>) => {
  const profile = await callerFor(profileRouter, userId);
  const initial = await profile.getUser();
  const client = new QueryClient();
  client.setQueryData(key, initial);
  const read = vi.fn(() => profile.getUser());
  const observer = new QueryObserver(client, {
    queryKey: key,
    staleTime: Infinity,
    queryFn: read,
  });
  const stop = observer.subscribe(() => undefined);
  try {
    const revision = prepareUserUpdate(client, key);
    const result = await mutate();
    expect(result).toMatchObject({ success: true });
    expect(await updateUserCache(client, key, result, { revision })).toBe(true);
    expect(read).not.toHaveBeenCalled();
    return client.getQueryData<typeof initial>(key)!.userData!;
  } finally {
    stop();
    client.clear();
  }
};

describeWithDatabase("item, jutsu and imbuing recovery cache projections", () => {
  beforeEach(async () => {
    await resetTables(
      userItemImbuement,
      itemLoadout,
      userItem,
      item,
      jutsuLoadout,
      userJutsu,
      userQueue,
      jutsu,
      questHistory,
      quest,
      userVote,
      userData,
    );
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await insertUsers([
      {
        userId,
        username: userId,
        level: 50,
        rank: "JONIN",
        status: "ASLEEP",
        isOutlaw: true,
        occupation: "CRAFTING",
        craftingExperience: CRAFTING_REQUIRED_EXP.MASTER,
        federalStatus: "GOLD",
        primaryElement: "Fire",
        secondaryElement: "Water",
        money: 100_000,
        regenAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    await insertUserVotes([{ userId }]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps generated jutsu queue rows and charges while waking without a profile read", async () => {
    const db = await getTestDatabase();
    await insertJutsus([{ id: "training", name: "Training" }]);
    await db
      .insert(userJutsu)
      .values({ id: "owned-training", userId, jutsuId: "training", level: 1 });
    const api = await callerFor(jutsuRouter, userId);
    const cached = await applyMutation(() =>
      api.startTraining({ jutsuId: "training", levels: 2 }),
    );
    const saved = (await db.query.userData.findFirst({
      where: eq(userData.userId, userId),
    }))!;
    const queue = await db.query.userQueue.findMany({
      where: eq(userQueue.userId, userId),
    });
    expect(cached).toMatchObject({ status: "AWAKE", money: saved.money });
    expect(queue).toHaveLength(1);
    expect(cached.queue).toEqual(queue);
  });

  it("replaces evolved equipment and derived mastery without a profile read", async () => {
    await insertItems([
      { id: "parent", itemType: "ARMOR", slot: "CHEST", maxDurability: 100 },
      {
        id: "evolved",
        parentItemId: "parent",
        itemType: "ARMOR",
        slot: "CHEST",
        maxDurability: 50,
        effects: [
          getTagSchema("increasemastery").parse({
            power: 25,
            masteryTypes: ["Ninjutsu"],
          }),
        ],
      },
    ]);
    await insertUserItems([
      {
        id: "worn",
        userId,
        itemId: "parent",
        equipped: "CHEST",
        quantity: 1,
        durability: 100,
        level: ITEM_LEVEL_CAP,
      },
    ]);
    const api = await callerFor(itemRouter, userId);
    const cached = await applyMutation(() =>
      api.evolveItem({ userItemId: "worn", evolutionItemId: "evolved" }),
    );
    expect(cached.items).toEqual([
      expect.objectContaining({
        id: "worn",
        itemId: "evolved",
        level: 1,
        durability: 50,
      }),
    ]);
    const current = await (await callerFor(profileRouter, userId)).getUser();
    expect(current?.userData).toBeDefined();
    expect(cached).toMatchObject({
      effectiveMasteries: current?.userData?.effectiveMasteries,
      maxEnergy: current?.userData?.maxEnergy,
    });
  });

  it("rejects an evolution after the loaded equipment row changes without losing recovery or materials", async () => {
    const db = await getTestDatabase();
    await insertItems([
      { id: "parent", itemType: "ARMOR", slot: "CHEST", maxDurability: 100 },
      {
        id: "evolved",
        parentItemId: "parent",
        itemType: "ARMOR",
        slot: "CHEST",
        maxDurability: 50,
      },
    ]);
    await insertUserItems([
      {
        id: "worn",
        userId,
        itemId: "parent",
        equipped: "CHEST",
        quantity: 1,
        durability: 100,
        level: ITEM_LEVEL_CAP,
      },
    ]);
    await (await callerFor(profileRouter, userId)).getUser();
    const raced = beforeStatements(db, userItem, [
      async () => {
        await db
          .update(userItem)
          .set({ equipped: "NONE", durability: 25 })
          .where(eq(userItem.id, "worn"));
      },
    ]);
    const result = await callerForDatabase(itemRouter, userId, raced).evolveItem({
      userItemId: "worn",
      evolutionItemId: "evolved",
    });
    expect(result.success).toBe(false);
    expect(result.userRecovery).toBeUndefined();
    expect(
      await db.query.userItem.findFirst({ where: eq(userItem.id, "worn") }),
    ).toMatchObject({
      itemId: "parent",
      equipped: "NONE",
      durability: 25,
      quantity: 1,
    });
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, userId) }),
    ).toMatchObject({ status: "ASLEEP", money: 100_000 });
  });

  it("applies a confirmed carried-stack merge with recovery without a profile read", async () => {
    await insertItems([{ id: "material", stackSize: 100 }]);
    await insertUserItems([
      { id: "first", userId, itemId: "material", quantity: 2 },
      { id: "second", userId, itemId: "material", quantity: 3 },
    ]);
    const api = await callerFor(itemRouter, userId);
    const cached = await applyMutation(() => api.mergeStacks({ itemId: "material" }));
    expect(cached.status).toBe("AWAKE");
    expect(cached.items).toEqual([]);
  });

  it("applies imbuing XP and recovery without replacing unrelated equipment or refetching", async () => {
    await insertItems([
      { id: "armor", itemType: "ARMOR", slot: "CHEST", canBeImbued: true },
      { id: "crystal", itemType: "CRYSTAL", rarity: "COMMON", craftingExperience: 80 },
    ]);
    await insertUserItems([
      { id: "armor-row", userId, itemId: "armor" },
      { id: "crystal-row", userId, itemId: "crystal" },
    ]);
    const api = await callerFor(occupationRouter, userId);
    const cached = await applyMutation(() =>
      api.imbueItem({ userItemId: "armor-row", userCrystalItemId: "crystal-row" }),
    );
    const saved = (await (
      await getTestDatabase()
    ).query.userData.findFirst({ where: eq(userData.userId, userId) }))!;
    expect(cached).toMatchObject({
      status: "AWAKE",
      craftingExperience: saved.craftingExperience,
    });
    expect(cached.craftingExperience).toBeGreaterThan(CRAFTING_REQUIRED_EXP.MASTER);
    expect(cached.items).toEqual([]);
  });
});
