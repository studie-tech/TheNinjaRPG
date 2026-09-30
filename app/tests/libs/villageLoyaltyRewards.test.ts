// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserStatNames } from "@/drizzle/constants";
import { calcBattleResult } from "@/libs/combat/util";
import { getReward, postProcessRewards } from "@/libs/quest";
import { fetchUpdatedUser, profileRouter } from "@/routers/profile";
import { updateRewards } from "@/routers/quests";
import { QuestValidator } from "@/validators/objectives";
import { ObjectiveReward, PostProcessedRewardSchema } from "@/validators/rewards";
import { makeBattleUser, makeCompleteBattle } from "./combat/helpers/battleScenario";

vi.mock("@/server/db", () => ({ drizzleDB: {} }));
vi.mock("@/env/server.mjs", () => ({
  env: { NODE_ENV: "test", NEXT_PUBLIC_BASE_URL: "http://localhost:3000" },
}));
vi.mock("@/env/client.mjs", () => ({
  env: { NEXT_PUBLIC_BASE_URL: "http://localhost:3000" },
}));
vi.mock("@/libs/moderator", () => ({
  moderateContent: vi.fn(),
  validateUserUpdateReason: vi.fn(),
}));

const NOW = new Date("2026-09-19T12:00:00Z");
const member = (days: number) => ({
  isOutlaw: false,
  villageId: "village-1",
  joinedVillageAt: new Date(NOW.getTime() - days * 86_400_000),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const questReward = (days: number, questType: "daily" | "mission", amount: number) => {
  const quest = {
    id: "quest-1",
    ...QuestValidator.parse({
      name: "Loyalty reward", description: null, successDescription: null,
      tierLevel: null, questType, hidden: false, consecutiveObjectives: false,
      startsAt: null, endsAt: null,
      content: {
        objectives: [0, 1, 2].map((id) => ({
          id: `goal-${id}`, task: "win_quest", description: "Complete", successDescription: "",
        })),
        reward: { reward_prestige: amount },
      },
    }),
  };
  const user = {
    ...member(days), userId: "user-1", level: 50, rank: "JONIN", role: "USER",
    sector: 1, village: { id: "village-1", sector: 1, structures: [], sectors: [] },
    activeWars: [], completedQuests: [], dailyMissions: 0, senseiId: null,
    questData: [{ id: quest.id, goals: [0, 1, 2].map((id) => ({ id: `goal-${id}`, value: 0, done: true })) }],
    userQuests: [{ id: "history-1", questId: quest.id, completed: 0, previousAttempts: 0, previousCompletes: 0, quest }],
  } as unknown as Parameters<typeof getReward>[0];
  return getReward(user, quest.id);
};

describe("loyalty reward delivery", () => {
  it.each(["daily", "mission"] as const)("keeps %s prestige penalties unchanged", (type) => {
    for (const days of [0, 14, 90]) {
      const result = questReward(days, type, -100);
      expect(result.resolved).toBe(true);
      expect(result.rewards.reward_prestige).toBe(-100);
    }
  });

  it("keeps positive mission and village bonuses additive and applies them once", () => {
    expect(questReward(90, "daily", 1000).rewards.reward_prestige).toBe(1130);
    expect(questReward(90, "mission", 1000).rewards.reward_prestige).toBe(1180);
  });

  it("boosts unscaled configured payouts without changing penalties", () => {
    const rewards = ObjectiveReward.parse({ reward_prestige: 1000, reward_tokens: 1000 });
    expect(postProcessRewards(rewards, member(90))).toMatchObject({ reward_prestige: 1130, reward_tokens: 1130 });
    expect(postProcessRewards(rewards)).toMatchObject({ reward_prestige: 1000, reward_tokens: 1000 });
    expect(postProcessRewards(ObjectiveReward.parse({ reward_prestige: -100 }), member(90)).reward_prestige).toBe(-100);
  });

  it("boosts arena stats while preserving rewardless battles", () => {
    const result = (days: number, battleType: "ARENA" | "TRAINING" = "ARENA") => calcBattleResult(
      makeCompleteBattle({
        battleType, rewardScaling: 1,
        usersState: [
          makeBattleUser("winner", { ...member(days), experience: 1000, usedGenerals: { strength: 1, speed: 0, intelligence: 0, willpower: 0 } }),
          makeBattleUser("loser", { curHealth: 0, leftBattle: true, isAi: true, experience: 1000 }),
        ],
      }), "winner", [],
    );
    const base = result(0)!.strength;
    expect(base).toBeGreaterThan(0);
    expect(result(20)!.strength).toBeCloseTo(base * 1.05);
    expect(result(70)!.strength).toBeCloseTo(base * 1.15);
    expect(result(70)!.experience).toBe(result(70)!.strength);
    expect(result(70, "TRAINING")!.strength).toBe(0);
  });

  it("boosts converted stats while spending the original allocatable XP", async () => {
    const user = {
      ...Object.fromEntries(UserStatNames.map((key) => [key, 100])),
      ...member(70), userId: "user-1", rank: "JONIN", experience: 1000, earnedExperience: 1000,
    };
    const database = {
      query: { userData: { findFirst: vi.fn().mockResolvedValue(user) } },
      update: () => ({ set: () => ({ where: vi.fn().mockResolvedValue({ rowsAffected: 1 }) }) }),
    };
    const api = profileRouter.createCaller({ userId: "user-1", drizzle: database } as never);
    const input = { ninjutsuOffence: 0, taijutsuOffence: 0, genjutsuOffence: 0, bukijutsuOffence: 0,
      ninjutsuDefence: 0, taijutsuDefence: 0, genjutsuDefence: 0, bukijutsuDefence: 0,
      strength: 100, speed: 0, intelligence: 0, willpower: 0 };
    const response = await api.useUnusedExperiencePoints(input);
    expect(response).toMatchObject({ success: true, data: { strength: 215, earnedExperience: 900, experience: 1115 } });
  });

  it.each(["village-1", "village-2"])("changes membership age only when the destination %s differs", async (villageId) => {
    const sets: Record<string, unknown>[] = [];
    const db = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ id: villageId, name: "AKIKAZE" }]) }) }),
      update: () => ({ set: (data: Record<string, unknown>) => { sets.push(data); return { where: () => Promise.resolve({ rowsAffected: 1 }) }; } }),
    };
    await updateRewards({
      client: db as never,
      user: { ...member(90), userId: "user-1", questData: [], occupation: "NONE" } as never,
      rewards: PostProcessedRewardSchema.parse({ reward_village_membership: "AKIKAZE" }),
      reason: "QUEST",
    });
    expect(sets[0]?.villageId).toBe(villageId);
    if (villageId === "village-1") expect(sets[0]).not.toHaveProperty("joinedVillageAt");
    else expect(sets[0]?.joinedVillageAt).toEqual(NOW);
  });
});


const profileSnapshot = (isOutlaw: boolean, anbuId: string | null = null) => ({
  ...makeBattleUser("user-1"), ...member(isOutlaw ? 0 : 90),
  isOutlaw, villageId: isOutlaw ? "syndicate" : "village-1",
  villagePrestige: isOutlaw ? 100 : -100,
  village: { id: isOutlaw ? "syndicate" : "village-1", type: isOutlaw ? "OUTLAW" : "VILLAGE", structures: [], sectors: [] },
  status: "BATTLE", anbuId, anbuSquad: anbuId ? { name: "Squad" } : null,
  clanId: null, clan: null, bloodline: null, sageMode: null, activeReskin: null,
  userQuests: [], completedQuests: [], votes: {}, promotions: [], questData: [],
});

const profileClient = (snapshots: ReturnType<typeof profileSnapshot>[], failCleanup = false, maxReads = Infinity) => {
  const selection = Object.assign(Promise.resolve([]), {
    from: () => selection, where: () => selection, leftJoin: () => selection,
    limit: () => selection, orderBy: () => selection,
  });
  let reads = 0;
  let writes = 0;
  const db = {
    select: () => selection,
    query: {
      userData: { findFirst: () => {
        if (reads >= maxReads) throw new Error("Exceeded profile read budget");
        return Promise.resolve(structuredClone(snapshots[Math.min(reads++, snapshots.length - 1)]));
      } },
      war: { findMany: () => Promise.resolve([]) },
      mpvpBattleQueue: { findMany: () => Promise.resolve([]) },
      quest: { findMany: () => Promise.resolve([]) },
      village: { findFirst: () => Promise.resolve({ id: "syndicate", type: "OUTLAW" }) },
      anbuSquad: { findFirst: () => Promise.resolve({ id: "squad-1", name: "Squad", memberCount: 2 }) },
    },
    update: () => ({ set: () => ({ where: async () => {
      const index = writes++;
      if (failCleanup && index === 0) throw new Error("temporary cleanup failure");
      // Expulsion CAS loses; retry cleanup succeeds except the leadership CAS.
      return { rowsAffected: failCleanup ? (index === 3 ? 0 : 1) : 0 };
    } }) }),
  };
  return { db: db as never, reads: () => reads, writes: () => writes };
};

describe("village expulsion recovery", () => {
  it("bounds repeated expulsion CAS losses", async () => {
    const { db, reads } = profileClient([profileSnapshot(false)], false, 3);
    await expect(fetchUpdatedUser({ client: db, userId: "user-1" })).rejects.toThrow("User state changed concurrently");
    expect(reads()).toBe(3);
  });

  it("does not repeatedly expel an already-outlaw account with inconsistent village data", async () => {
    const snapshot = { ...profileSnapshot(false), isOutlaw: true };
    const { db, reads, writes } = profileClient([snapshot], false, 1);
    const result = await fetchUpdatedUser({ client: db, userId: "user-1" });
    expect(result.user?.isOutlaw).toBe(true);
    expect(reads()).toBe(1);
    expect(writes()).toBe(0);
  });

  it("reloads full membership and relations after a lost expulsion CAS", async () => {
    const fresh = profileSnapshot(true);
    const { db, reads } = profileClient([profileSnapshot(false), fresh]);
    const result = await fetchUpdatedUser({ client: db, userId: "user-1" });
    expect(reads()).toBe(2);
    expect(result.user).toMatchObject({ isOutlaw: true, villageId: "syndicate", joinedVillageAt: fresh.joinedVillageAt, village: { type: "OUTLAW" } });
  });

  it("retries failed ANBU cleanup even after the account is already an outlaw", async () => {
    const { db, writes } = profileClient([profileSnapshot(true, "squad-1")], true);
    await expect(fetchUpdatedUser({ client: db, userId: "user-1" })).rejects.toThrow("temporary cleanup failure");
    const result = await fetchUpdatedUser({ client: db, userId: "user-1" });
    expect(writes()).toBe(4);
    expect(result.user).toMatchObject({ isOutlaw: true, anbuId: null, anbuSquad: null });
  });
});
