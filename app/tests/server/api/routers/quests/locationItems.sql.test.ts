import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { eq } from "drizzle-orm";
import { getInventoryQuantities } from "@/deltas/item";
import {
  item,
  quest,
  questHistory,
  sectorMap,
  type UserItemWithRelations,
  userData,
  userItem,
} from "@/drizzle/schema";
import { itemRouter } from "@/routers/item";
import { questsRouter } from "@/routers/quests";
import { invalidatePublishedMapCache } from "@/server/utils/sectorMap";
import { DeliverItem } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertItems,
  insertQuestHistory,
  insertQuests,
  insertUserItems,
  insertUsers,
} from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../../setup/testDatabase";

const userId = "location-merge-player";

describeWithDatabase("location quest inventory recovery", () => {
  beforeEach(async () => {
    await resetTables(userItem, item, questHistory, quest, sectorMap, userData);
    invalidatePublishedMapCache();
    const now = new Date();
    setSystemTime(now);
    await insertUsers([
      {
        userId,
        username: userId,
        rank: "GENIN",
        level: 20,
        status: "AWAKE",
        isOutlaw: true,
        regeneration: 0,
        updatedAt: now,
        regenAt: now,
        primaryElement: "Fire",
        secondaryElement: "Water",
      },
    ]);
    await insertItems([{ id: "merge-herb", stackSize: 100 }]);
  });
  afterEach(() => {
    setSystemTime();
    invalidatePublishedMapCache();
  });

  it("projects a confirmed whole-stack delivery against the canonical inventory", async () => {
    const db = await getTestDatabase();
    const user = (await db.query.userData.findFirst({
      where: eq(userData.userId, userId),
    }))!;
    await insertQuests([
      {
        id: "delivery",
        questType: "mission",
        content: {
          objectives: [
            DeliverItem.parse({
              id: "deliver",
              task: "deliver_item",
              sector: user.sector,
              longitude: user.longitude,
              latitude: user.latitude,
              deliverItemIds: ["merge-herb"],
            }),
          ],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
    await insertQuestHistory([{ userId, questId: "delivery", questType: "mission" }]);
    await insertUserItems([
      { id: "delivery-stack", userId, itemId: "merge-herb", quantity: 3 },
    ]);
    const items = await callerFor(itemRouter, userId),
      before = await items.getUserItems();
    const result = await (await callerFor(questsRouter, userId)).checkLocationQuest();
    expect(result.success).toBe(true);
    expect(result.itemsChanged).toBe(true);
    expect(result.inventoryChanges).toEqual([
      { id: "delivery-stack", itemId: "merge-herb", beforeQuantity: 3, quantity: 0 },
    ]);
    expect(getInventoryQuantities(before, result.inventoryChanges)).toEqual(
      await items.getUserItems(),
    );
  });

  it.each(["empty", "fresh", "stale"] as const)(
    "refreshes active inventory caches only when recovering a stale merge claim (%s)",
    async (claim) => {
      const db = await getTestDatabase();
      const now = new Date();
      if (claim !== "empty") {
        await insertUserItems([
          {
            id: "claimed-herbs",
            userId,
            itemId: "merge-herb",
            quantity: -4,
            updatedAt: now,
          },
        ]);
      }
      const items = await callerFor(itemRouter, userId);
      const client = new QueryClient({
        defaultOptions: { queries: { staleTime: Infinity, retry: false } },
      });
      const queries = [
        {
          queryKey: ["item", "getUserItems"],
          queryFn: vi.fn(() => items.getUserItems()),
        },
        {
          queryKey: ["item", "getUserItemsWithVariants"],
          queryFn: vi.fn(() => items.getUserItemsWithVariants()),
        },
      ];
      const unsubscribe = queries.map((query) =>
        new QueryObserver<UserItemWithRelations[]>(client, query).subscribe(() => {}),
      );
      try {
        expect(
          await Promise.all(
            queries.map((query) => client.fetchQuery<UserItemWithRelations[]>(query)),
          ),
        ).toEqual([[], []]);
        setSystemTime(new Date(now.getTime() + (claim === "stale" ? 31_000 : 1_000)));
        const quests = await callerFor(questsRouter, userId);
        const { result, statements } = await recordQueries(() =>
          quests.checkLocationQuest(),
        );
        expect(result.success).toBe(true);
        const restored = await db.query.userItem.findFirst({
          where: eq(userItem.id, "claimed-herbs"),
        });
        expect(restored?.quantity).toBe(
          claim === "empty" ? undefined : claim === "stale" ? 4 : -4,
        );

        // Match Sector's conditional invalidation with both inventory queries actively observed.
        if (result.itemsChanged) {
          await Promise.all(
            queries.map((query) =>
              client.invalidateQueries({ queryKey: query.queryKey }),
            ),
          );
        }
        for (const query of queries) {
          const inventory = client.getQueryData<UserItemWithRelations[]>(
            query.queryKey,
          );
          expect(inventory).toHaveLength(claim === "stale" ? 1 : 0);
          if (claim === "stale")
            expect(inventory?.[0]).toMatchObject({ itemId: "merge-herb", quantity: 4 });
          expect(query.queryFn).toHaveBeenCalledTimes(claim === "stale" ? 2 : 1);
        }
        expect(result.itemsChanged).toBe(claim === "stale");
        // Recovery reuses the existing read/refetch; normal crossings keep one inventory read.
        expect(
          statements.filter((statement) =>
            /^select .* from `UserItem` /i.test(statement),
          ),
        ).toHaveLength(claim === "stale" ? 2 : 1);
      } finally {
        for (const stop of unsubscribe) stop();
        client.clear();
      }
    },
  );
});
