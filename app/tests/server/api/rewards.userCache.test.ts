import { describe, expect, it } from "bun:test";
import { getRewardUserDelta } from "@/server/api/routers/quests";
import { PostProcessedRewardSchema } from "@/validators/rewards";

const reward = (input: Record<string, unknown> = {}) =>
  PostProcessedRewardSchema.parse(input);

describe("confirmed reward cache deltas", () => {
  it("returns the granted currencies and earned XP with a paid catch-up debit", () => {
    expect(getRewardUserDelta(reward({
      reward_money: 100,
      reward_exp: 50,
      reward_seichi_silver: 2,
      reward_reputation: 3,
      reward_prestige: 4,
    }), 10, true)).toEqual({
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

  it.each(["reward_money", "reward_seichi_silver", "reward_exp"])(
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
    ["reward_skillpoints", 1],
  ])("reconciles %s because its derived state is not represented", (field, value) => {
    expect(getRewardUserDelta(reward({ [field as string]: value }))).toBeUndefined();
  });
});
