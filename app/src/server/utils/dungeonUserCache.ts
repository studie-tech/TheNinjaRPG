import { getRewardUserDelta } from "@/server/api/routers/quests";
import type { ActivityCompletions } from "@/server/utils/achievementObjectives";
import type { PostProcessedRewards } from "@/validators/rewards";

/** Confirmed scalar delivery returns its known delta and opening completion count. */
export const getDungeonRewardUserUpdate = (
  before: ActivityCompletions,
  rewards: PostProcessedRewards | undefined,
) => {
  const delta = rewards && getRewardUserDelta(rewards);
  if (!delta || (rewards?.reward_exp ?? 0) > 0)
    return { userPatch: undefined, userDelta: undefined };
  return {
    userPatch: { dungeonsCompleted: before.dungeonsCompleted },
    userDelta: delta,
  };
};
