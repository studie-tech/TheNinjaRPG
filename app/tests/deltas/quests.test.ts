import { describe, expect, it } from "bun:test";
import type { RouterOutputs } from "@/app/_trpc/client";
import {
  getQuestRewardCacheUpdate,
  getQuestRewardDashboardUpdate,
  getQuestStartDiscoveryUpdate,
  getQuestStartUpcomingUpdate,
  getReopenedQuestIds,
  getRewardUserDelta,
} from "@/deltas/quests";
import { PostProcessedRewardSchema } from "@/validators/rewards";

const reward = (input: Record<string, unknown> = {}) =>
  PostProcessedRewardSchema.parse(input);

describe("confirmed reward cache deltas", () => {
  it("returns the granted currencies and earned XP with a paid catch-up debit", () => {
    expect(
      getRewardUserDelta(
        reward({
          reward_money: 100,
          reward_exp: 50,
          reward_seichi_silver: 2,
          reward_reputation: 3,
          reward_prestige: 4,
        }),
        10,
        true,
      ),
    ).toEqual({
      money: 100,
      earnedExperience: 50,
      seichiSilver: 2,
      reputationPoints: -7,
      reputationPointsTotal: 3,
      villagePrestige: 4,
    });
  });

  it("reconciles reputation rewards without a hydrated quest snapshot", () => {
    expect(getRewardUserDelta(reward({ reward_reputation: 3 }))).toBeUndefined();
  });

  it.each(["reward_money", "reward_seichi_silver", "reward_exp", "reward_skillpoints"])(
    "reconciles fractional %s because its atomic payout targets an integer column",
    (field) => {
      expect(getRewardUserDelta(reward({ [field]: 0.6 }), 0, true)).toBeUndefined();
      expect(getRewardUserDelta(reward({ [field]: -0.6 }), 0, true)).toBeUndefined();
    },
  );

  it.each([
    ["reward_prestige", -1],
    ["reward_rank", "GENIN"],
    ["reward_village_membership", "AKIKAZE"],
    ["reward_items", ["item"]],
    ["reward_jutsus", ["jutsu"]],
    ["reward_bloodlines", ["bloodline"]],
    ["reward_sage_modes", ["sage"]],
    ["reward_badges", ["badge"]],
    ["reward_hunter_items", true],
    ["reward_gathering_items", true],
    ["reward_clanpoints", 1],
    ["reward_anbupoints", 1],
    ["reward_tokens", 1],
    ["reward_war_damage", 1],
    ["reward_war_healing", 1],
    ["reward_medical_experience", 1],
    ["reward_hunting_experience", 1],
    ["reward_crafting_experience", 1],
    ["reward_gathering_experience", 1],
    ["reward_sage_mastery_experience", 1],
    ["reward_pet_experience", 1],
    ["reward_skillpoints", 1],
  ])("reconciles %s because its derived state is not represented", (field, value) => {
    expect(getRewardUserDelta(reward({ [field as string]: value }))).toBeUndefined();
  });
});

it("accepts unequipped inventory and skill point grants with a hydrated quest snapshot", () => {
  const delta = getRewardUserDelta(
    reward({
      reward_items: ["gift"],
      reward_jutsus: ["jutsu"],
      reward_badges: ["badge"],
      reward_skillpoints: 3,
    }),
    0,
    true,
  );
  expect(delta).toMatchObject({ money: 0 });
  expect(delta).not.toHaveProperty("skillPoints");
});

it("projects completion counts across a UTC period rollover and preserves raid summaries", () => {
  const prior = new Date("2026-10-31T00:00:00Z");
  const at = new Date("2026-11-01T12:00:00Z");
  const update = getQuestRewardCacheUpdate(
    {
      questId: "quest",
      previousAttempts: 4,
      previousCompletes: 3,
      periodCompletes: 2,
      periodStartAt: prior,
      quest: { retryDelay: "daily" },
    },
    at,
    reward(),
    false,
  );
  expect(update.after).toEqual({
    previousAttempts: 4,
    previousCompletes: 4,
    periodCompletes: 1,
    periodStartAt: new Date("2026-11-01T00:00:00Z"),
  });
  expect(update.discoveryUnchanged).toBe(false);
  const current = {
    candidates: [{ id: "quest", previousAttempts: 3, ...update.before }],
    raidProgress: [{ raidId: "raid", damageDealt: 4 }],
    raidRewards: [],
  } as unknown as RouterOutputs["profile"]["getDashboard"];
  const next = getQuestRewardDashboardUpdate(current, update);
  expect(next?.candidates[0]?.previousCompletes).toBe(4);
  expect(next?.candidates[0]?.previousAttempts).toBe(4);
  expect(
    getQuestRewardDashboardUpdate(
      { ...current, candidates: [{ ...current.candidates[0]!, previousAttempts: 5 }] },
      update,
    ),
  ).toBeUndefined();
  expect(next?.raidProgress).toBe(current.raidProgress);
  expect(current.candidates[0]?.previousCompletes).toBe(3);
  expect(getQuestRewardDashboardUpdate(next!, update)).toBeUndefined();
});

it.each([
  [{}, true],
  [{ reward_money: 1, reward_exp: 20, reward_seichi_silver: 2 }, true],
  [{ reward_money: -1 }, true],
  [{ reward_prestige: 3 }, true],
  [{ reward_items: ["item"] }, false],
  [{ reward_stats: 1 }, false],
  [{ reward_level: 101 }, false],
  [{ reward_prestige: -1 }, false],
])("keeps discovery for nonterminal balance-only claims (%j)", (fields, unchanged) => {
  const entry = { questId: "quest", quest: { retryDelay: "none" as const } };
  expect(
    getQuestRewardCacheUpdate(entry, null, reward(fields), false).discoveryUnchanged,
  ).toBe(unchanged);
  expect(
    getQuestRewardCacheUpdate(entry, null, reward(fields), true).discoveryUnchanged,
  ).toBe(false);
  expect(
    getQuestRewardCacheUpdate(entry, new Date(), reward(fields), false)
      .discoveryUnchanged,
  ).toBe(false);
});

describe("quest start discovery patches", () => {
  const periodStartAt = new Date("2026-11-01T00:00:00Z");
  const attempt = {
    questId: "started",
    previousAttempts: 3,
    previousCompletes: 2,
    completed: 0,
    periodCompletes: 1,
    periodStartAt,
  };
  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    prerequisiteQuestId: null as string | null,
    previousAttempts: 2,
    previousCompletes: 2,
    completed: 1,
    periodCompletes: 1,
    periodStartAt,
    ...extra,
  });

  it("syncs started attempt counters and keeps other rows by identity", () => {
    const other = row("other");
    const next = getQuestStartDiscoveryUpdate(
      [row("started"), other],
      [attempt],
      [],
      undefined,
    );
    expect(next?.[0]).toEqual({ ...row("started"), previousAttempts: 3, completed: 0 });
    expect(next?.[1]).toBe(other);
  });

  it("closes quests whose reopened prerequisite is no longer completed", () => {
    const rows = [row("started"), row("follow-up", { prerequisiteQuestId: "started" })];
    expect(
      getQuestStartDiscoveryUpdate(rows, [attempt], ["started"], [])?.map((r) => r.id),
    ).toEqual(["started"]);
  });

  it("debits confirmed entry stock and refetches unconfirmed stock", () => {
    const rows = [
      {
        ...row("ticketed"),
        entryRequirements: [
          { itemId: "ticket", quantity: 1, name: "Ticket", owned: 3 },
        ],
      },
    ];
    const changes = [
      { id: "a", itemId: "ticket", beforeQuantity: 2, quantity: 1 },
      { id: "b", itemId: "other", beforeQuantity: 5, quantity: 0 },
    ];
    expect(
      getQuestStartDiscoveryUpdate(rows, [], [], changes)?.[0]?.entryRequirements,
    ).toEqual([{ itemId: "ticket", quantity: 1, name: "Ticket", owned: 2 }]);
    expect(getQuestStartDiscoveryUpdate(rows, [], [], undefined)).toBeUndefined();
  });

  it("keeps upcoming quests unless a completed prerequisite was reopened", () => {
    const rows = [{ id: "upcoming" }];
    expect(getQuestStartUpcomingUpdate(rows, [])).toBe(rows);
    expect(getQuestStartUpcomingUpdate(rows, ["started"])).toBeUndefined();
  });

  it("lists completions the start reopened", () => {
    expect(
      getReopenedQuestIds(
        [
          { questId: "started", completed: 1 },
          { questId: "kept", completed: 1 },
          { questId: "failed", completed: 0 },
        ],
        [{ questId: "kept", completed: 1 }],
      ),
    ).toEqual(["started"]);
  });
});
