import { describe, expect, it } from "bun:test";
import { getQuestRewardSummary, getRewardArray } from "@/libs/objectives";
import { hasReward, ObjectiveReward } from "@/validators/rewards";

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
    expect(hasReward(ObjectiveReward.parse({ reward_sage_modes: ["sm_1"] }))).toBe(
      true,
    );
    expect(hasReward(ObjectiveReward.parse({ reward_sage_modes: [] }))).toBe(false);
  });
});

describe("getQuestRewardSummary", () => {
  type Content = Parameters<typeof getQuestRewardSummary>[0];

  it("shows the completion reward when it grants anything", () => {
    const content = {
      reward: { reward_money: 100 },
      objectives: [{ reward_exp: 5 }],
    } as unknown as Content;
    expect(getQuestRewardSummary(content)).toEqual({
      label: "Reward",
      rewards: ["100 ryo"],
    });
  });

  it("summarises objective rewards when the completion reward is empty", () => {
    const content = {
      reward: {},
      objectives: [{ reward_money: 50 }, { reward_exp: 5 }],
    } as unknown as Content;
    expect(getQuestRewardSummary(content)).toEqual({
      label: "Objective rewards",
      rewards: ["50 ryo", "5 exp"],
    });
  });

  it("returns undefined when nothing is granted", () => {
    const content = { reward: {}, objectives: [{}] } as unknown as Content;
    expect(getQuestRewardSummary(content)).toBeUndefined();
  });
});
