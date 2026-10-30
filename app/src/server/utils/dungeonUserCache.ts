import type { UserData } from "@/drizzle/schema";
import { getRewardUserDelta } from "@/server/api/routers/quests";
import type { ActivityCompletions } from "@/server/utils/achievementObjectives";
import type { PostProcessedRewards } from "@/validators/rewards";

/** New scalar delivery returns its known delta; receipt replay never grants it twice. */
export const getDungeonRewardUserUpdate = (
  before: UserData & ActivityCompletions,
  rewards: PostProcessedRewards | undefined,
  replay = false,
) => {
  const delta = rewards && getRewardUserDelta(rewards);
  if (!delta || (!replay && (rewards?.reward_exp ?? 0) > 0))
    return { userPatch: undefined, userDelta: undefined };
  return {
    userPatch: {
      dungeonsCompleted: before.dungeonsCompleted,
      ...(replay
        ? {
            money: before.money,
            seichiSilver: before.seichiSilver,
            earnedExperience: before.earnedExperience,
            petExperience: before.petExperience,
            reputationPoints: before.reputationPoints,
            reputationPointsTotal: before.reputationPointsTotal,
            villagePrestige: before.villagePrestige,
          }
        : {}),
    },
    userDelta: replay ? {} : delta,
  };
};
