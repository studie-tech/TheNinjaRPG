// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { userData, userStatTrainingQueue } from "@/drizzle/schema";
import { settleAllQueuesForUser, settleStatTrainingQueue } from "@/server/utils/queue";

vi.mock("@/env/server.mjs", () => ({ env: { NODE_ENV: "test" } }));
vi.mock("@/env/client.mjs", () => ({ env: {} }));
vi.mock("@/server/db", () => ({ drizzleDB: {} }));
vi.mock("@/libs/moderator", () => ({ moderateContent: vi.fn(), validateUserUpdateReason: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn(() => { throw new Error("Queue settlement must not refresh a session"); }));
vi.mock("@/routers/profile", () => ({ fetchUpdatedUser: refresh }));

const fixture = (claimRows = 1) => {
  const oldUpdatedAt = new Date("2026-01-01T00:00:00Z");
  const quest = {
    id: "quest", name: "Queue progress", questType: "daily", hidden: false,
    consecutiveObjectives: false, maxAttempts: 100, maxCompletes: 100,
    requiredVillage: null, requiredBloodlineId: null, prerequisiteQuestId: null,
    requiredLevel: null, maxLevel: null, medicalRank: null, huntingRank: null,
    gatheringRank: null, endsAt: null,
    content: { objectives: ["stats_trained", "jutsus_mastered", "items_crafted"].map((task) => ({
      id: task, task, value: 100, description: "", successDescription: "",
    })), reward: {} },
  };
  const user = {
    userId: "user", level: 50, rank: "JONIN", role: "USER", villageId: "village",
    isOutlaw: false, bloodlineId: null, sector: 1, updatedAt: oldUpdatedAt,
    medicalExperience: 0, huntingExperience: 0, gatheringExperience: 0,
    craftingExperience: 0, items: [], completedQuests: [], questData: [],
    village: { id: "village", sector: 1 },
    userQuests: [{ id: "history", questId: "quest", completed: 0, previousAttempts: 0, previousCompletes: 0, quest }],
  } as unknown as Parameters<typeof import("@/libs/quest").getNewTrackers>[0];
  const readLocks: number[] = [];
  let active = 0;
  let maxActive = 0;
  let locked = false;
  const writes: Record<string, unknown>[] = [];
  const db = {
    query: {
      userStatTrainingQueue: { findMany: async () => [{ id: "stat", stat: "strength", fullStatGain: 2, fullExperienceGain: 2, durationSeconds: 60, trainingSpeed: "NORMAL", finishesAt: oldUpdatedAt }] },
      userJutsuTrainingQueue: { findMany: async () => [{ id: "jutsu", jutsuId: "jutsu" }] },
      userCraftingQueue: { findMany: async () => [{ id: "craft", itemId: "item", quantity: 3, craftingExperience: 1, outputCreatedAt: null }] },
      userData: { findFirst: async () => { readLocks.push(Number(locked)); return structuredClone(user); } },
      userJutsu: { findFirst: async () => undefined },
      item: { findFirst: async () => ({ stackSize: 99 }) },
    },
    update: (table: unknown) => ({ set: (data: Record<string, unknown>) => ({ where: async () => {
      if (table === userData) {
        writes.push(data);
        if ("updatedAt" in data) locked = true;
        if ("questData" in data) user.questData = structuredClone(data.questData) as typeof user.questData;
      }
      return { rowsAffected: table === userStatTrainingQueue ? claimRows : 1 };
    } }) }),
    insert: () => ({ values: async () => ({ rowsAffected: 1 }) }),
    transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      active++; maxActive = Math.max(active, maxActive);
      await Promise.resolve();
      try { return await run(db); } finally { active--; locked = false; }
    },
  };
  return { db: db as never, user, writes, readLocks, maxActive: () => maxActive, oldUpdatedAt };
};

describe("queue settlement", () => {
  it("preserves all three queues' quest progress without marking an offline user online", async () => {
    const state = fixture();
    expect(await settleAllQueuesForUser(state.db, "user")).toBe(3);
    const goals = state.user.questData?.[0]?.goals;
    expect(goals?.find((g) => g.id === "stats_trained")?.value).toBe(2);
    expect(goals?.find((g) => g.id === "jutsus_mastered")?.value).toBe(1);
    expect(goals?.find((g) => g.id === "items_crafted")?.value).toBe(3);
    expect(state.maxActive()).toBe(1);
    expect(state.readLocks).toEqual([1, 1, 1]);
    expect(state.user.updatedAt).toEqual(state.oldUpdatedAt);
    expect(state.writes.some((write) => write.updatedAt instanceof Date)).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("grants no quest progress after another worker claims the stat job", async () => {
    const state = fixture(0);
    expect(await settleStatTrainingQueue(state.db, "user")).toBe(0);
    expect(state.user.questData).toEqual([]);
    expect(state.readLocks).toEqual([]);
  });
});
