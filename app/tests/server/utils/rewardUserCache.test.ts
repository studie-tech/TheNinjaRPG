import { expect, it, vi } from "bun:test";
import { postProcessRewards } from "@/libs/quest/rewards";
import { getRewardUserUpdate } from "@/deltas/quests";
import { ObjectiveReward } from "@/validators/rewards";

it.each(["experience", "relations", "scalar"] as const)(
  "projects reward progress only when the %s delivery can use it",
  (kind) => {
    const rewards = postProcessRewards(
      ObjectiveReward.parse({
        reward_money: 10,
        reward_exp: kind === "experience" ? 1 : 0,
      }),
    );
    const progression = vi.fn(() => ({
      userPatch: { money: 20 },
      achievementProgress: [],
    }));
    const result = getRewardUserUpdate({
      rewards,
      requiresRelations: kind === "relations",
      progression: progression as never,
    });
    expect(progression).toHaveBeenCalledTimes(kind === "scalar" ? 1 : 0);
    if (kind === "scalar")
      expect(result).toMatchObject({
        userPatch: { money: 20 },
        userDelta: { money: 10 },
        achievementProgress: [],
      });
    else expect(result.userPatch).toBeUndefined();
  },
);
