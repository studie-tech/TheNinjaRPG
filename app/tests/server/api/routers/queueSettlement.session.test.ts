import { expect, it } from "bun:test";
import { userItem, userQueue } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import {
  type QueuedCraft,
  returnCraftMaterials,
  settleCraftingQueue,
} from "@/server/utils/userQueue";

it("reschedules remaining crafts in one statement on the transaction", async () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const activeFinish = new Date(now.getTime() + 60_000);
  const writes: unknown[] = [];
  let inFlight = false;
  let committed = false;
  const rows = [1, 2].map((position) => ({
    id: `craft-${position}`,
    userId: "owner",
    kind: "CRAFT",
    position,
    createdAt: now,
    energy: null,
    jutsuId: null,
    reservedRyo: null,
    stat: null,
    speed: null,
    itemId: "item",
    quantity: 1,
    craftBatches: null,
    materials: [],
    durationSeconds: 60,
    startsAt: new Date(now.getTime() + (position - 1) * 60_000),
    finishesAt: new Date(now.getTime() + position * 60_000),
    item: null,
  })) as QueuedCraft[];
  const select = (value: unknown[]) => ({ from: () => ({ where: async () => value }) });
  const tx = {
    select: () => select([{ finish: activeFinish }]),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: async () => {
          if (table !== userQueue) return { rowsAffected: 1 };
          if (inFlight) throw new Error("transaction in use: for query");
          inFlight = true;
          await new Promise<void>((resolve) => setTimeout(resolve, 1));
          writes.push(values);
          inFlight = false;
          return { rowsAffected: 1 };
        },
      }),
    }),
  };
  const client = {
    // Upfront snapshot misses a craft started by another request. The locked reread
    // sees it, so both waiting jobs must move behind its deadline in this transaction.
    select: () => select([]),
    transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => {
      const result = await callback(tx);
      committed = true;
      return result;
    },
  } as unknown as DrizzleClient;
  expect(await settleCraftingQueue(client, "owner", now, rows)).toBe(0);
  expect(committed).toBe(true);
  expect(writes).toHaveLength(1);
});

it("returns multiple reserved materials without overlapping transaction statements", async () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const materials = [1, 2].map((quantity) => ({
    userItemId: `gone-${quantity}`,
    itemId: `material-${quantity}`,
    quantity,
    storedAtHome: false,
  }));
  let inFlight = false;
  let committed = false;
  const mergeWrites: unknown[] = [];
  const inserts: (typeof userItem.$inferInsert)[][] = [];
  const select = () => ({ from: () => ({ where: async () => [] }) });
  const tx = {
    select,
    delete: () => ({ where: async () => ({ rowsAffected: 1 }) }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: async () => {
          if (table !== userItem) return { rowsAffected: 1 };
          if (inFlight) throw new Error("transaction in use: for query");
          inFlight = true;
          await new Promise<void>((resolve) => setTimeout(resolve, 1));
          mergeWrites.push(values);
          inFlight = false;
          return { rowsAffected: 0 };
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (values: (typeof userItem.$inferInsert)[]) => {
        expect(table).toBe(userItem);
        expect(inFlight).toBe(false);
        inserts.push(values);
        return { rowsAffected: values.length };
      },
    }),
  };
  const client = {
    select,
    transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => {
      const result = await callback(tx);
      committed = true;
      return result;
    },
  } as unknown as DrizzleClient;
  const entry = {
    id: "invalid-craft",
    userId: "owner",
    kind: "CRAFT",
    startsAt: now,
    finishesAt: new Date(now.getTime() + 60_000),
    durationSeconds: 60,
    item: null,
    materials,
  } as QueuedCraft;
  expect(await settleCraftingQueue(client, "owner", now, [entry])).toBe(0);
  expect(committed).toBe(true);
  expect(mergeWrites).toHaveLength(2);
  expect(inserts).toHaveLength(1);
  expect(inserts[0]?.map(({ itemId, quantity }) => ({ itemId, quantity }))).toEqual([
    { itemId: "material-1", quantity: 1 },
    { itemId: "material-2", quantity: 2 },
  ]);
});

it("keeps independent material refunds parallel outside a transaction", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const client = {
    update: () => ({
      set: () => ({
        where: async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise<void>((resolve) => setTimeout(resolve, 1));
          inFlight--;
          return { rowsAffected: 1 };
        },
      }),
    }),
  } as unknown as DrizzleClient;
  await returnCraftMaterials(
    client,
    "owner",
    [1, 2].map((quantity) => ({
      userItemId: `stack-${quantity}`,
      itemId: `material-${quantity}`,
      quantity,
      storedAtHome: false,
    })),
  );
  expect(maxInFlight).toBe(2);
});
