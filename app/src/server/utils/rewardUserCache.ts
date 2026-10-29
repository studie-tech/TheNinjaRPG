import type { GetRewardResult } from "@/libs/quest";
import { findRewardUserSnapshot } from "@/queries/quests";
import {
  fetchUpdatedUser,
  getUserProgressionUpdate,
} from "@/server/api/routers/profile";
import type { updateRewards } from "@/server/api/routers/quests";
import type { DrizzleClient } from "@/server/db";
import { MASTERY_EXPERIENCE_FIELDS } from "@/validators/rewards";

/** Confirm SQL-capped counters; hydrate derived relations only when the reward changes them. */
export const getRewardUserUpdate = async (input: {
  client: DrizzleClient;
  userId: string;
  rewards: GetRewardResult;
  granted: Pick<
    Awaited<ReturnType<typeof updateRewards>>,
    "titles" | "badges" | "sageModes"
  >;
  requiresRelations?: boolean;
  progression?: ReturnType<typeof getUserProgressionUpdate>;
}) => {
  const { client, userId, rewards, granted } = input;
  const needsRelations =
    input.requiresRelations ||
    rewards.reward_rank !== "NONE" ||
    rewards.reward_village_membership !== "NONE" ||
    granted.titles.length > 0 ||
    granted.badges.length > 0 ||
    granted.sageModes.length > 0 ||
    rewards.reward_clanpoints !== 0 ||
    rewards.reward_anbupoints !== 0 ||
    rewards.reward_war_damage !== 0 ||
    rewards.reward_war_healing !== 0 ||
    MASTERY_EXPERIENCE_FIELDS.some((field) => (rewards[field] ?? 0) !== 0) ||
    (rewards.reward_mastery_rank != null && rewards.reward_mastery_rank !== "NONE");
  const hydrated = needsRelations
    ? await fetchUpdatedUser({ client, userId })
    : undefined;
  const counters = await findRewardUserSnapshot(client, userId);
  const progression = hydrated?.user
    ? getUserProgressionUpdate(hydrated.user, hydrated.publishedAchievementIds)
    : input.progression;
  return {
    userDelta: {},
    achievementProgress: progression?.achievementProgress,
    userPatch: hydrated?.user
      ? {
          ...progression?.userPatch,
          ...counters,
          village: hydrated.user.village,
          villageId: hydrated.user.villageId,
          isOutlaw: hydrated.user.isOutlaw,
          joinedVillageAt: hydrated.user.joinedVillageAt,
          clan: hydrated.user.clan,
          anbuSquad: hydrated.user.anbuSquad,
          titles: hydrated.user.titles,
          displayTitle: hydrated.user.displayTitle,
          sageModeId: hydrated.user.sageModeId,
          sageMode: hydrated.user.sageMode,
          raidBuffs: hydrated.user.raidBuffs,
        }
      : counters
        ? {
            ...progression?.userPatch,
            ...counters,
            village: counters.village ?? undefined,
          }
        : undefined,
  };
};
