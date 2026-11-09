import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, setSystemTime } from "bun:test";
import { eq } from "drizzle-orm";
import { getFarmBulkMutationUpdate } from "@/deltas/farming";
import { getEquippedInventory } from "@/deltas/item";
import {
  farmCollectionLog,
  farmPlot,
  item,
  itemLoadout,
  userData,
  userItem,
} from "@/drizzle/schema";
import { farmingRouter } from "@/server/api/routers/farming";
import { itemRouter } from "@/server/api/routers/item";
import { profileRouter } from "@/server/api/routers/profile";
import { prepareQueryUpdate, updateQueryCache } from "@/utils/queryCache";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { insertItems, insertUserItems, insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const initialTime = new Date("2026-11-02T12:00:00Z");
const claimTime = new Date(initialTime.getTime() - 29_000);
const recoveryTime = new Date(initialTime.getTime() + 2_000);
const cleanups: (() => void)[] = [];

/** Keep a cached view active so an omitted projection must complete its real query refetch. */
const observeCache = <T>(
  client: QueryClient,
  key: string[],
  before: T,
  query: () => Promise<T>,
) => {
  client.setQueryData(key, before);
  let refetches = 0;
  const observer = new QueryObserver(client, {
    queryKey: key,
    staleTime: Infinity,
    queryFn: () => {
      refetches++;
      return query();
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  cleanups.push(unsubscribe);
  return { key, revision: prepareQueryUpdate(client, key), refetches: () => refetches };
};

describeWithDatabase("mutation cache recovery for abandoned merge claims", () => {
  beforeEach(async () => {
    setSystemTime(initialTime);
    await resetTables(
      itemLoadout,
      farmCollectionLog,
      farmPlot,
      userItem,
      item,
      userData,
    );
    await insertUsers([
      {
        userId: "recovery-player",
        level: 10,
        rank: "JONIN",
        farmingExperience: 1000,
        regeneration: 0,
      },
    ]);
  });

  afterEach(() => {
    cleanups
      .splice(0)
      .reverse()
      .forEach((close) => close());
    setSystemTime();
  });

  it("refetches both inventory views after loadout preloading restores an unrelated stack", async () => {
    const db = await getTestDatabase();
    await insertItems([
      { id: "armor", itemType: "ARMOR", slot: "CHEST", maxDurability: 100 },
      { id: "herb", canStack: true, stackSize: 50 },
    ]);
    await insertUserItems([
      {
        id: "armor-stack",
        userId: "recovery-player",
        itemId: "armor",
        durability: 100,
      },
      {
        id: "abandoned",
        userId: "recovery-player",
        itemId: "herb",
        quantity: -3,
        updatedAt: claimTime,
      },
    ]);
    await db.insert(itemLoadout).values({
      id: "loadout",
      userId: "recovery-player",
      name: "Loadout",
      itemData: [{ userItemId: "armor-stack", itemId: "armor", slot: "CHEST" }],
    });
    const api = await callerFor(itemRouter, "recovery-player");
    const client = new QueryClient();
    cleanups.push(() => client.clear());
    const before = await api.getUserItems();
    const beforeVariants = await api.getUserItemsWithVariants();
    expect(before.map((row) => row.id)).toEqual(["armor-stack"]);
    expect(beforeVariants.map((row) => row.id)).toEqual(["armor-stack"]);
    const inventory = observeCache(client, ["inventory"], before, () =>
      api.getUserItems(),
    );
    const variants = observeCache(client, ["variants"], beforeVariants, () =>
      api.getUserItemsWithVariants(),
    );
    const profileKey = ["profile"];
    client.setQueryData(
      profileKey,
      await (await callerFor(profileRouter, "recovery-player")).getUser(),
    );
    const profileRevision = prepareUserUpdate(client, profileKey);

    setSystemTime(recoveryTime);
    const result = await api.selectItemLoadout({ id: "loadout" });
    expect(result.success, result.message).toBe(true);
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "abandoned") }))
        ?.quantity,
    ).toBe(3);
    // Recovery changes ordinary inventory membership without invalidating the equipped profile patch.
    expect(
      await updateUserCache(client, profileKey, result, { revision: profileRevision }),
    ).toBe(true);
    expect(result.equipmentChanges).toBeUndefined();
    expect(getEquippedInventory(before, result.equipmentChanges)).toBeUndefined();
    expect(
      await updateQueryCache<typeof before>(
        client,
        inventory.key,
        (rows) => getEquippedInventory(rows, result.equipmentChanges),
        inventory,
      ),
    ).toBe(false);
    expect(
      await updateQueryCache<typeof beforeVariants>(
        client,
        variants.key,
        (rows) => getEquippedInventory(rows, result.equipmentChanges),
        variants,
      ),
    ).toBe(false);
    expect(inventory.refetches()).toBe(1);
    expect(variants.refetches()).toBe(1);
    expect(client.getQueryData(inventory.key)).toEqual(await api.getUserItems());
    expect(client.getQueryData(variants.key)).toEqual(
      await api.getUserItemsWithVariants(),
    );
    expect(client.getQueryData<typeof before>(inventory.key)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "abandoned", quantity: 3 }),
        expect.objectContaining({ id: "armor-stack", equipped: "CHEST" }),
      ]),
    );
  });

  it("refetches the farm after bulk harvest preloading restores an unrelated seed stack", async () => {
    const db = await getTestDatabase();
    await insertItems([
      {
        id: "crop",
        canStack: true,
        stackSize: 50,
        farmSellValue: 1,
        farmHarvestExperience: 1,
      },
      {
        id: "seed",
        canStack: true,
        stackSize: 50,
        isFarmSeed: true,
        farmYieldItemId: "crop",
        farmGrowTimeSeconds: 3600,
      },
    ]);
    await insertUserItems([
      { id: "crop-stack", userId: "recovery-player", itemId: "crop", quantity: 2 },
      {
        id: "abandoned-seeds",
        userId: "recovery-player",
        itemId: "seed",
        quantity: -3,
        updatedAt: claimTime,
      },
    ]);
    await db.insert(farmCollectionLog).values({
      id: "collected",
      userId: "recovery-player",
      itemId: "crop",
      firstHarvestedAt: initialTime,
    });
    await db.insert(farmPlot).values({
      id: "ready",
      userId: "recovery-player",
      slotIndex: 0,
      seedItemId: "seed",
      plantedAt: new Date(initialTime.getTime() - 7_200_000),
      finishAt: new Date(initialTime.getTime() - 1000),
    });
    const api = await callerFor(farmingRouter, "recovery-player");
    const before = await api.getFarmState();
    expect(before.availableSeeds).toEqual([]);
    const client = new QueryClient();
    cleanups.push(() => client.clear());
    const farm = observeCache(client, ["farm"], before, async () => {
      const state = await api.getFarmState();
      return state;
    });

    // The claim expires inside the farm controller's 30-second polling interval.
    setSystemTime(recoveryTime);
    const result = await api.harvestAll();
    expect(result.success, result.message).toBe(true);
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "abandoned-seeds") }))
        ?.quantity,
    ).toBe(3);
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "crop-stack") }))
        ?.quantity,
    ).toBe(3);
    expect(result.inventoryChanges).toBeUndefined();
    expect(getFarmBulkMutationUpdate(before, result, "harvest")).toBeUndefined();
    expect(
      await updateQueryCache<typeof before>(
        client,
        farm.key,
        (state) => getFarmBulkMutationUpdate(state, result, "harvest"),
        farm,
      ),
    ).toBe(false);
    expect(farm.refetches()).toBe(1);
    expect(client.getQueryData(farm.key)).toEqual(await api.getFarmState());
    expect(client.getQueryData<typeof before>(farm.key)?.availableSeeds).toMatchObject([
      { itemId: "seed", quantity: 3 },
    ]);
    expect(client.getQueryData<typeof before>(farm.key)?.sellableCrops).toMatchObject([
      { itemId: "crop", quantity: 3 },
    ]);
  });
});
