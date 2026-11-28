import { describe, expect, it } from "bun:test";
import { getMissionHallRewardPreview } from "@/libs/quest/missionHall";

describe("getMissionHallRewardPreview", () => {
  it("shows the range of base rewards across the tile's quests", () => {
    expect(
      getMissionHallRewardPreview([
        { content: { reward: { reward_exp: 120.6, reward_money: 900 } } },
        { content: { reward: { reward_exp: 220, reward_money: 1400 } } },
      ]),
    ).toBe("120–220 XP · 900–1,400 ryo");
  });

  it("collapses equal values and drops unpaid currencies", () => {
    expect(
      getMissionHallRewardPreview([
        { content: { reward: { reward_exp: 0, reward_money: 500 } } },
        { content: { reward: { reward_money: 500 } } },
      ]),
    ).toBe("500 ryo");
  });

  it("is empty for an empty tile or one that pays nothing", () => {
    expect(getMissionHallRewardPreview([])).toBeUndefined();
    expect(getMissionHallRewardPreview([{ content: {} }])).toBeUndefined();
  });
});
