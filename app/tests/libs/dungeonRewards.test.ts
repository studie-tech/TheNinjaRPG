import { afterEach, expect, it, vi } from "bun:test";
import { dungeonRewardError, rollDungeonRewards } from "@/libs/dungeonRewards";
import { ObjectiveReward } from "@/validators/rewards";
import { dungeonContent } from "../setup/dungeon";

afterEach(() => vi.restoreAllMocks());

it("rolls once for the whole drop quantity and preserves package item chances", () => {
  const rewards = dungeonContent().rewards;
  rewards.drops = [
    { type: "item", id: "hit", chance: 50, quantity: 4 },
    { type: "item", id: "miss", chance: 50, quantity: 4 },
    {
      type: "package",
      id: "pack",
      chance: 100,
      quantity: 2,
      package: {
        name: "Bundle",
        description: "",
        rewards: ObjectiveReward.parse({
          reward_money: 7,
          reward_items: [{ ids: ["nested"], number: 50, quantity: 3 }],
        }),
      },
    },
  ];
  vi.spyOn(Math, "random")
    .mockReturnValueOnce(0.49)
    .mockReturnValueOnce(0.5)
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0.49)
    .mockReturnValue(0.5);
  const rolled = rollDungeonRewards(rewards);
  expect(rolled.reward_money).toBe(114);
  expect(rolled.reward_items).toEqual([
    "hit",
    "hit",
    "hit",
    "hit",
    "nested",
    "nested",
    "nested",
  ]);
});

it("bounds worst-case package quantities before expanding nested item rewards", () => {
  const rewards = dungeonContent().rewards;
  rewards.drops = [
    {
      type: "package",
      id: "pack",
      chance: 1,
      quantity: 100,
      package: {
        name: "Bundle",
        description: "",
        rewards: ObjectiveReward.parse({
          reward_items: [{ ids: ["item"], number: 1, quantity: 20 }],
        }),
      },
    },
  ];
  expect(dungeonRewardError(rewards)).toBeNull();
  rewards.drops.push({ type: "cache", id: "cache", chance: 1, quantity: 1 });
  expect(dungeonRewardError(rewards)).toContain("at most 2000 items");
  rewards.drops[0]!.package!.rewards.reward_items[0]!.quantity = 1e9;
  expect(dungeonRewardError(rewards)).toContain("at most 2000 items");
});

it("rejects scalar overflow from multiplied packages and combined base rewards", () => {
  const rewards = dungeonContent().rewards;
  rewards.drops = [
    {
      type: "package",
      id: "pack",
      chance: 1,
      quantity: 100,
      package: {
        name: "Bundle",
        description: "",
        rewards: ObjectiveReward.parse({ reward_exp: 30000000 }),
      },
    },
  ];
  expect(dungeonRewardError(rewards)).toContain("per scalar reward");
  rewards.drops[0]!.package!.rewards.reward_exp = 10000000;
  rewards.experience = 0;
  expect(dungeonRewardError(rewards)).toBeNull();
  rewards.experience = 1;
  expect(dungeonRewardError(rewards)).toContain("per scalar reward");
});

it("keeps missed one-time drops eligible and suppresses only successful rewards", () => {
  const rewards = dungeonContent().rewards;
  rewards.drops = [
    { type: "item", id: "unique", chance: 50, quantity: 2, onlyOnce: true },
    { type: "item", id: "repeat", chance: 100, quantity: 1 },
  ];
  vi.spyOn(Math, "random").mockReturnValue(0.75);
  const missed = rollDungeonRewards(rewards);
  expect(missed.grantedDrops).toEqual([JSON.stringify(["item", "repeat"])]);
  vi.spyOn(Math, "random").mockReturnValue(0);
  const first = rollDungeonRewards(rewards, new Set(missed.grantedDrops));
  expect(first.reward_items).toEqual(["unique", "unique", "repeat"]);
  const repeated = rollDungeonRewards(rewards, new Set(first.grantedDrops));
  expect(repeated.reward_items).toEqual(["repeat"]);
  expect(repeated.reward_money).toBe(100);
});

it("uses reward identity across row reorderings and suppresses duplicate one-time rows", () => {
  const rewards = dungeonContent().rewards;
  rewards.drops = [
    { type: "cache", id: "unique", chance: 100, quantity: 1, onlyOnce: true },
    { type: "cache", id: "unique", chance: 100, quantity: 1, onlyOnce: true },
  ];
  vi.spyOn(Math, "random").mockReturnValue(0);
  const first = rollDungeonRewards(rewards);
  expect(first.reward_items).toEqual(["unique"]);
  rewards.drops.reverse();
  expect(rollDungeonRewards(rewards, new Set(first.grantedDrops)).reward_items).toEqual(
    [],
  );
});

it.each([false, true])(
  "grants repeatable and one-time rows sharing a key in either order (reverse: %s)",
  (reverse) => {
    const rewards = dungeonContent().rewards;
    rewards.drops = [
      { type: "item", id: "shared", chance: 100, quantity: 2 },
      { type: "item", id: "shared", chance: 100, quantity: 3, onlyOnce: true },
      { type: "item", id: "shared", chance: 100, quantity: 3, onlyOnce: true },
    ];
    if (reverse) rewards.drops.reverse();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const first = rollDungeonRewards(rewards);
    expect(first.reward_items).toEqual(Array(5).fill("shared"));
    expect(first.grantedDrops).toEqual([JSON.stringify(["item", "shared"])]);
    const repeated = rollDungeonRewards(rewards, new Set(first.grantedDrops));
    expect(repeated.reward_items).toEqual(["shared", "shared"]);
    expect(repeated.grantedDrops).toEqual(first.grantedDrops);
  },
);
