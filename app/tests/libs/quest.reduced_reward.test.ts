import { describe, expect, it } from "vitest";
import { MISSIONS_FULL_REWARD_COUNT } from "@/drizzle/constants";
import { isReducedMissionReward } from "@/libs/quest";

describe("isReducedMissionReward", () => {
  it("pre-start warns once the last full-reward mission is already done", () => {
    expect(
      isReducedMissionReward(MISSIONS_FULL_REWARD_COUNT - 1, { phase: "pre-start" }),
    ).toBe(false);
    expect(
      isReducedMissionReward(MISSIONS_FULL_REWARD_COUNT, { phase: "pre-start" }),
    ).toBe(true);
    expect(
      isReducedMissionReward(MISSIONS_FULL_REWARD_COUNT + 1, { phase: "pre-start" }),
    ).toBe(true);
  });

  it("in-progress matches claim after the counter has been incremented at start", () => {
    expect(
      isReducedMissionReward(MISSIONS_FULL_REWARD_COUNT, { phase: "in-progress" }),
    ).toBe(false);
    expect(
      isReducedMissionReward(MISSIONS_FULL_REWARD_COUNT + 1, { phase: "in-progress" }),
    ).toBe(true);
  });
});
