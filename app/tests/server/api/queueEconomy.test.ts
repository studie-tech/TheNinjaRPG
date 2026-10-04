// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { userData, userJutsuTrainingQueue } from "@/drizzle/schema";
import { calcJutsuTrainCost } from "@/libs/train";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { occupationRouter } from "@/server/api/routers/occupation";

const mocks = vi.hoisted(() => ({ user: vi.fn(), items: vi.fn(), recipe: vi.fn() }));
vi.mock("@/env/server.mjs", () => ({ env: { NODE_ENV: "test" } }));
vi.mock("@/env/client.mjs", () => ({ env: {} }));
vi.mock("@/server/db", () => ({ drizzleDB: {} }));
vi.mock("@/libs/moderator", () => ({
  moderateContent: vi.fn(),
  validateUserUpdateReason: vi.fn(),
}));
vi.mock("@/server/api/routers/profile", () => ({
  fetchUpdatedUser: mocks.user,
  fetchUser: vi.fn(),
}));
vi.mock("@/server/api/routers/item", () => ({
  fetchUserItems: mocks.items,
  fetchItemWithCraftingRequirements: mocks.recipe,
}));
vi.mock("@/routers/sensei", () => ({ fetchStudents: async () => [] }));
vi.mock("@/server/utils/queue", () => ({
  settleCraftingQueue: vi.fn(),
  settleJutsuTrainingQueue: vi.fn(),
  getCraftingQueue: async () => ({ active: null, waiting: [] }),
  getJutsuTrainingQueue: async () => ({ active: null, waiting: [] }),
}));
vi.mock("@/server/api/trpc", () => {
  const procedure = {
    meta() {
      return this;
    },
    input() {
      return this;
    },
    output() {
      return this;
    },
    query(fn: unknown) {
      return fn;
    },
    mutation(fn: unknown) {
      return fn;
    },
  };
  return {
    protectedProcedure: procedure,
    publicProcedure: procedure,
    baseServerResponse: { extend: () => ({}) },
    createTRPCRouter: (router: unknown) => router,
    errorResponse: (message: string) => ({ success: false, message }),
    serverError: vi.fn(),
  };
});

type Resolver = (args: {
  ctx: { userId: string; drizzle: unknown };
  input: unknown;
}) => Promise<{ success: boolean; message: string }>;
const craftItem = (occupationRouter as unknown as { craftItem: Resolver }).craftItem;
const jutsuMutations = jutsuRouter as unknown as {
  cancelQueuedTraining: Resolver;
  stopTraining: Resolver;
};
const user = {
  userId: "user",
  status: "AWAKE",
  sector: 1,
  occupation: "CRAFTING",
  craftingExperience: 0,
  isOutlaw: true,
  federalStatus: "NONE",
  senseiId: null,
  level: 10,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ user });
});

describe("crafting reservation rollback", () => {
  it.each([
    "missing",
    "guard",
  ])("restores an earlier material when the later stack is %s", async (failure) => {
    const stacks = ["ore", "wood"].map((id) => ({
      id,
      itemId: id,
      quantity: 2,
      isInAuction: false,
      item: {},
    }));
    mocks.items.mockResolvedValue(stacks);
    mocks.recipe.mockResolvedValue({
      id: "output",
      name: "Output",
      canBeCrafted: true,
      rarity: "COMMON",
      craftingRequirements: stacks.map((stack) => ({
        requirementItemId: stack.id,
        quantity: 2,
      })),
    });
    let inventory = ["ore", "wood"];
    let rolledBack = false;
    let deletions = 0;
    const insert = vi.fn();
    const tx = {
      query: {
        userData: { findFirst: async () => user },
        userCraftingQueue: { findMany: async () => [] },
        userItem: {
          findMany: async () => (failure === "missing" ? [stacks[0]] : stacks),
        },
      },
      update: () => ({ set: () => ({ where: async () => ({ rowsAffected: 1 }) }) }),
      delete: () => ({
        where: async () => {
          deletions++;
          if (deletions === 2) return { rowsAffected: 0 };
          inventory = inventory.filter((id) => id !== "ore");
          return { rowsAffected: 1 };
        },
      }),
      insert,
    };
    const db = {
      transaction: async (run: (tx: unknown) => Promise<unknown>) => {
        const snapshot = [...inventory];
        try {
          return await run(tx);
        } catch (error) {
          inventory = snapshot;
          rolledBack = true;
          throw error;
        }
      },
    };
    const result = await craftItem({
      ctx: { userId: "user", drizzle: db },
      input: { itemId: "output", quantity: 1 },
    });
    expect(result).toEqual({
      success: false,
      message: "Materials changed, please try again",
    });
    expect(rolledBack).toBe(true);
    expect(inventory).toEqual(["ore", "wood"]);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("jutsu cancellation reservations", () => {
  it.each([
    "cancelQueuedTraining",
    "stopTraining",
  ] as const)("%s keeps the paid reservation when a discount ends", async (method) => {
    const info = { jutsuRank: "D", extraBaseCost: 0 } as Parameters<
      typeof calcJutsuTrainCost
    >[0];
    const discountedUser = { ...user, senseiId: "sensei" } as Parameters<
      typeof calcJutsuTrainCost
    >[2];
    const paid = calcJutsuTrainCost(info, 1, discountedUser, []);
    expect(calcJutsuTrainCost(info, 1, user as never, [])).toBeGreaterThan(paid);
    const remaining = [
      {
        id: "active",
        jutsuId: "jutsu",
        reservedRyo: calcJutsuTrainCost(info, 0, discountedUser, []),
      },
      { id: "waiting", jutsuId: "jutsu", reservedRyo: paid },
    ];
    const reservations: number[] = [];
    const query = {
      userJutsu: { findMany: async () => [], findFirst: async () => undefined },
      userJutsuTrainingQueue: {
        findFirst: async () => ({ id: "target", jutsuId: "jutsu", reservedRyo: 65 }),
        findMany: vi.fn().mockResolvedValueOnce(remaining).mockResolvedValue([]),
      },
      jutsu: { findFirst: async () => info },
    };
    const tx = {
      query,
      update: (table: unknown) => ({
        set: (data: Record<string, unknown>) => ({
          where: async () => {
            if (
              table === userJutsuTrainingQueue &&
              typeof data.reservedRyo === "number"
            )
              reservations.push(data.reservedRyo);
            if (table === userData && "money" in data) expect(data.money).toBeDefined();
            return { rowsAffected: 1 };
          },
        }),
      }),
    };
    const selection = {
      from: () => selection,
      innerJoin: () => selection,
      leftJoin: () => selection,
      where: () => selection,
      orderBy: async () => [],
    };
    const db = {
      query,
      select: () => selection,
      transaction: async (run: (tx: unknown) => Promise<unknown>) => run(tx),
    };
    const result = await jutsuMutations[method]({
      ctx: { userId: "user", drizzle: db },
      input: { queueId: "target" },
    });
    expect(result.success).toBe(true);
    expect(reservations).toEqual(remaining.map((job) => job.reservedRyo));
  });
});
