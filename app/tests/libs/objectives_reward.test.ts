import { describe, expect, it } from "bun:test";
import { getRewardArray } from "@/libs/objectives";
import { ObjectiveReward, hasReward } from "@/validators/rewards";

describe("getRewardArray sage mastery experience", () => {
  it("includes sage mode experience in the reward summary", () => {
    const reward = {
      reward_sage_mastery_experience: 100,
    } as unknown as Parameters<typeof getRewardArray>[0];
    expect(getRewardArray(reward)).toContain("100 sage mode experience");
  });
});

describe("hasReward reward_sage_modes", () => {
  it("hasReward is true when reward_sage_modes is set", () => {
    expect(hasReward(ObjectiveReward.parse({ reward_sage_modes: ["sm_1"] }))).toBe(true);
    expect(hasReward(ObjectiveReward.parse({ reward_sage_modes: [] }))).toBe(false);
  });
});
