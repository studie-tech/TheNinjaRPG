import { describe, expect, it } from "vitest";
import { getRewardArray } from "@/libs/objectives";

describe("getRewardArray sage mastery experience", () => {
  it("includes sage mastery experience in the reward summary", () => {
    const reward = {
      reward_sage_mastery_experience: 100,
    } as unknown as Parameters<typeof getRewardArray>[0];
    expect(getRewardArray(reward)).toContain("100 sage mastery experience");
  });
});
